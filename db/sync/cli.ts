#!/usr/bin/env node
// Meta -> Neon sync job. Invoked directly (no scheduler yet — that's a
// later phase, see docs/AUDIT.md).
//
// ARCHITECTURE NOTE: this job does NOT go through the MCP protocol. MCP is
// how a conversational client (Claude) talks to the read/write tools; a
// server-side batch job has no use for that indirection — it would only
// add latency and another point of failure. Instead this file imports the
// MCP read tools' plain functions directly from src/tools/read/*.ts (the
// same functions test/manual-check.ts already calls the same way) and the
// shared src/client/meta-api.ts wrapper underneath them. No MCP tool code
// was duplicated or forked to make this work — it was already factored
// this way since Etape 1.
//
// Usage:
//   npm run db:sync -- --client gr-adlab-main --days 7
//   npm run db:sync -- --all --days 3
//   npm run db:sync -- --client gr-adlab-main --since 2026-01-01 --until 2026-08-01 --backfill
//   npm run db:sync -- --client gr-adlab-main --breakdown age --days 30
//   npm run db:sync -- --client gr-adlab-main --dry-run
//
// Options:
//   --client <slug>   Sync this one accounts.config.json client_id.
//   --all             Sync every accounts.config.json entry whose Neon
//                     client is active (or hasn't been bootstrapped yet —
//                     new clients default to active on first sync).
//   --days <N>        Insights window = last N days (default 7).
//   --since / --until Explicit YYYY-MM-DD window, overrides --days.
//   --backfill        Chunk the window into 30-day pieces, one insights
//                     call sequence per chunk. Safe to interrupt and
//                     re-run: every write is an idempotent upsert, so
//                     already-synced chunks just get harmlessly re-upserted
//                     rather than needing separate checkpoint tracking.
//   --breakdown <dim> Pull ONE breakdown dimension for insights (age,
//                     gender, publisher_platform, platform_position,
//                     impression_device, device_platform, region, country).
//                     Passing this flag more than once is a hard error —
//                     combining breakdowns multiplies row count by their
//                     cartesian product, never allowed from this CLI. Omit
//                     for the default (no breakdown).
//   --dry-run         Print what would be written, write nothing (not even
//                     a sync_runs row).

import { loadAccountsConfig } from "../../src/config/accounts.js";
import { getLastRateLimitUsage, resetRateLimitUsage } from "../../src/client/meta-api.js";
import { BREAKDOWNS, type BreakdownDimension } from "../../src/tools/read/get-insights.js";
import { connectAsSyncRole } from "./db-client.js";
import { upsertClientFromConfig } from "./upserts.js";
import { syncEntities, syncInsightsWindow } from "./run-client.js";

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(since: string, until: string): number {
  const ms = new Date(`${until}T00:00:00Z`).getTime() - new Date(`${since}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function chunkDateRange(since: string, until: string, chunkDays: number): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  let cursor = since;
  while (cursor <= until) {
    const chunkEnd = addDaysISO(cursor, chunkDays - 1);
    const end = chunkEnd > until ? until : chunkEnd;
    chunks.push([cursor, end]);
    cursor = addDaysISO(end, 1);
  }
  return chunks;
}

interface CliArgs {
  client?: string;
  all: boolean;
  days: number;
  since?: string;
  until?: string;
  backfill: boolean;
  breakdown?: BreakdownDimension;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { all: false, days: 7, backfill: false, dryRun: false };
  const breakdownFlags: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--client":
        args.client = argv[++i];
        break;
      case "--all":
        args.all = true;
        break;
      case "--days":
        args.days = Number(argv[++i]);
        break;
      case "--since":
        args.since = argv[++i];
        break;
      case "--until":
        args.until = argv[++i];
        break;
      case "--backfill":
        args.backfill = true;
        break;
      case "--breakdown":
        breakdownFlags.push(argv[++i]);
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: "${argv[i]}"`);
    }
  }

  if (breakdownFlags.length > 1) {
    throw new Error(
      `Refusing to run: ${breakdownFlags.length} breakdown dimensions requested (${breakdownFlags.join(", ")}). ` +
        `insights_daily breakdowns are one dimension at a time, never combined from this CLI — combining them multiplies row count by their cartesian product. Run separate invocations instead.`,
    );
  }
  if (breakdownFlags.length === 1) {
    const dim = breakdownFlags[0];
    if (!(BREAKDOWNS as readonly string[]).includes(dim)) {
      throw new Error(`Unknown --breakdown "${dim}". Valid values: ${BREAKDOWNS.join(", ")}`);
    }
    args.breakdown = dim as BreakdownDimension;
  }

  if (!args.client && !args.all) throw new Error("Provide --client <slug> or --all.");
  if (args.client && args.all) throw new Error("Provide either --client <slug> or --all, not both.");
  if (!Number.isFinite(args.days) || args.days <= 0) throw new Error("--days must be a positive number.");

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = args.since ?? daysAgoISO(args.days);
  const until = args.until ?? todayISO();

  if (args.breakdown && args.backfill) {
    const windowDays = daysBetween(since, until);
    if (windowDays > 90) {
      console.warn(
        `\n⚠️  WARNING: --breakdown "${args.breakdown}" combined with --backfill over a ${windowDays}-day window. ` +
          `This can produce a lot of rows (one per breakdown value per entity per day). Proceeding — narrow the window if that's not intended.\n`,
      );
    }
  }

  const configPath = process.env.ACCOUNTS_CONFIG_PATH ?? "./accounts.config.json";
  const config = loadAccountsConfig(configPath);
  const entries = args.client ? config.clients.filter((c) => c.client_id === args.client) : config.clients;
  if (entries.length === 0) {
    throw new Error(
      args.client
        ? `No accounts.config.json entry for client_id "${args.client}".`
        : "accounts.config.json has no clients configured.",
    );
  }

  const db = await connectAsSyncRole();
  console.log(`Connected as svc_sync. Window: ${since}..${until}${args.dryRun ? " [DRY RUN — nothing will be written]" : ""}`);

  try {
    resetRateLimitUsage();

    for (const entry of entries) {
      console.log(`\n=== ${entry.client_id} ===`);

      let neonClient: { id: string; isActive: boolean };
      try {
        neonClient = await upsertClientFromConfig(db, entry.client_id, entry.label ?? entry.client_id);
      } catch (error) {
        console.error(`[sync] Could not bootstrap Neon client row for "${entry.client_id}": ${msg(error)} — skipping this client.`);
        continue; // per-client isolation: one client's failure never stops the others
      }

      if (args.all && !neonClient.isActive) {
        console.log(`[sync] Skipping "${entry.client_id}": clients.is_active = false in Neon.`);
        continue;
      }

      if (args.dryRun) {
        try {
          const capturedDate = todayISO();
          const entities = await syncEntities(
            db,
            entry.client_id,
            neonClient.id,
            entry.ad_account_id,
            capturedDate,
            true,
            process.env.AD_NAME_ANGLE_PATTERN,
          );
          const chunks = args.backfill ? chunkDateRange(since, until, 30) : ([[since, until]] as Array<[string, string]>);
          for (const [chunkSince, chunkUntil] of chunks) {
            await syncInsightsWindow(
              db,
              entry.client_id,
              neonClient.id,
              entities.adAccountRowId,
              entities.currency,
              entities.ads,
              chunkSince,
              chunkUntil,
              args.breakdown,
              true,
            );
          }
          console.log(`[dry-run] "${entry.client_id}": ${entities.entitiesProcessed} entities previewed, no sync_runs row created.`);
        } catch (error) {
          console.error(`[dry-run] "${entry.client_id}" failed: ${msg(error)}`);
        }
        continue;
      }

      const runType = args.backfill ? "backfill" : "full_sync";
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO sync_runs (client_id, run_type, status) VALUES ($1, $2, 'running') RETURNING id`,
        [neonClient.id, runType],
      );
      const syncRunId = rows[0].id;

      let totalEntities = 0;
      const stepErrors: string[] = [];
      let fatalError: string | undefined;

      try {
        const capturedDate = todayISO();
        const entities = await syncEntities(
          db,
          entry.client_id,
          neonClient.id,
          entry.ad_account_id,
          capturedDate,
          false,
          process.env.AD_NAME_ANGLE_PATTERN,
        );
        totalEntities += entities.entitiesProcessed;
        stepErrors.push(...entities.errors);

        const chunks = args.backfill ? chunkDateRange(since, until, 30) : ([[since, until]] as Array<[string, string]>);
        for (const [chunkSince, chunkUntil] of chunks) {
          console.log(`[sync] insights_daily ${chunkSince}..${chunkUntil}`);
          const insights = await syncInsightsWindow(
            db,
            entry.client_id,
            neonClient.id,
            entities.adAccountRowId,
            entities.currency,
            entities.ads,
            chunkSince,
            chunkUntil,
            args.breakdown,
            false,
          );
          totalEntities += insights.entitiesProcessed;
          stepErrors.push(...insights.errors);
        }
      } catch (error) {
        fatalError = msg(error);
      }

      const peakUsage = getLastRateLimitUsage();
      const status = fatalError ? "failed" : stepErrors.length > 0 ? "partial" : "success";
      const errorMessage = fatalError ?? (stepErrors.length > 0 ? stepErrors.join(" | ") : null);

      await db.query(
        `UPDATE sync_runs
         SET status = $1, finished_at = now(), entities_processed = $2, error_message = $3, rate_limit_usage_peak_percent = $4
         WHERE id = $5`,
        [status, totalEntities, errorMessage, peakUsage?.percent ?? null, syncRunId],
      );

      console.log(
        `[sync] "${entry.client_id}" done: status=${status}, entities=${totalEntities}` +
          (peakUsage ? `, peak rate-limit usage=${peakUsage.percent}%` : ", no rate-limit usage header observed"),
      );
      if (stepErrors.length > 0) console.log(`[sync] step errors: ${stepErrors.join(" | ")}`);
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
