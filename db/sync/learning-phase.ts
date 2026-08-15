// Normalizes learning_stage_info.status into the small vocabulary
// db/README.md documents, without ever failing on an unexpected value —
// that's precisely how an undocumented status (e.g. a real LEARNING_LIMITED,
// unconfirmed as of docs/AUDIT.md) will get discovered: logged loudly,
// stored as "unknown", never a crash.

const KNOWN_MAPPING: Record<string, string> = {
  LEARNING: "learning",
  SUCCESS: "success",
  FAIL: "failed",
};

export function normalizeLearningStatus(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "not_delivering";

  const normalized = KNOWN_MAPPING[raw];
  if (normalized) return normalized;

  console.warn(
    `[sync] Unexpected learning_stage_info.status value: "${raw}" — storing it raw, normalized as "unknown". ` +
      `This is exactly how LEARNING_LIMITED (unconfirmed in docs/AUDIT.md) would surface — worth checking if you see this.`,
  );
  return "unknown";
}
