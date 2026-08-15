import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { neon } from "../../lib/neon";
import { toDateOnlyString } from "../../lib/dates";
import type { CreativeAngle } from "../../types/db";

const FORMATS = ["image", "video", "carousel", "autre"] as const;

interface Props {
  clientId: string;
  metaEntityId: string;
  /** The ad's own Meta creation date, used as the first_seen_date fallback when this is a brand-new angle — see computeFirstSeenDate below. */
  adCreatedTime: string | null;
  existing: CreativeAngle | null;
  onSaved: (angle: CreativeAngle) => void;
}

/**
 * Mirrors db/sync/upserts.ts's upsertParsedCreativeAngle first_seen_date
 * logic exactly: the earliest date this angle_label has ever been seen for
 * this client, or this ad's own creation date if it's genuinely new. Never
 * exposed as an editable field — see the brief: "gérée automatiquement".
 */
async function computeFirstSeenDate(clientId: string, angleLabel: string, ownDate: string): Promise<string> {
  const { data } = await neon
    .from("creative_angles")
    .select("first_seen_date")
    .eq("client_id", clientId)
    .eq("angle_label", angleLabel)
    .order("first_seen_date", { ascending: true })
    .limit(1);
  const earliestExisting = data?.[0]?.first_seen_date ? toDateOnlyString(data[0].first_seen_date) : null;
  if (!earliestExisting) return ownDate;
  return earliestExisting < ownDate ? earliestExisting : ownDate;
}

export function AngleForm({ clientId, metaEntityId, adCreatedTime, existing, onSaved }: Props) {
  const [category, setCategory] = useState(existing?.angle_category ?? "");
  const [label, setLabel] = useState(existing?.angle_label ?? "");
  const [hook, setHook] = useState(existing?.hook_excerpt ?? "");
  const [format, setFormat] = useState(existing?.format ?? "");
  const [origin, setOrigin] = useState(existing?.creation_origin ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setCategory(existing?.angle_category ?? "");
    setLabel(existing?.angle_label ?? "");
    setHook(existing?.hook_excerpt ?? "");
    setFormat(existing?.format ?? "");
    setOrigin(existing?.creation_origin ?? "");
  }, [existing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      setError("Le libellé de l'angle est obligatoire.");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const ownDate = toDateOnlyString(adCreatedTime) ?? toDateOnlyString(new Date())!;
      const firstSeenDate = existing?.first_seen_date
        ? toDateOnlyString(existing.first_seen_date)!
        : await computeFirstSeenDate(clientId, label.trim(), ownDate);

      const { data, error: upsertError } = await neon
        .from("creative_angles")
        .upsert(
          {
            client_id: clientId,
            meta_entity_type: "ad",
            meta_entity_id: metaEntityId,
            angle_category: category.trim() || null,
            angle_label: label.trim(),
            hook_excerpt: hook.trim() || null,
            format: format || null,
            creation_origin: origin.trim() || null,
            launch_date: ownDate,
            first_seen_date: firstSeenDate,
            source: "manual",
          },
          { onConflict: "meta_entity_type,meta_entity_id" },
        )
        .select()
        .single();

      if (upsertError) {
        setError(upsertError.message);
      } else if (data) {
        onSaved(data as CreativeAngle);
        setSavedAt(Date.now());
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Angle marketing</h3>
        {existing && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              existing.source === "manual"
                ? "bg-brand-blue-light text-brand-blue dark:bg-brand-blue/20 dark:text-brand-blue"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            }`}
          >
            Origine : {existing.source === "manual" ? "saisie manuelle" : "parsing auto"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
          Catégorie d'angle
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="ex. preuve sociale"
          />
        </label>
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
          Libellé court *
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="ex. Témoignage client"
          />
        </label>
      </div>

      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
        Extrait du hook
        <textarea
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
          Format
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="">—</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
          Origine du visuel
          <input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="ex. Canva, freelance, IA"
          />
        </label>
      </div>

      {existing?.first_seen_date && (
        <p className="text-xs text-slate-400">
          Première apparition de cet angle sur le compte : {toDateOnlyString(existing.first_seen_date)} (calculée automatiquement, non modifiable)
        </p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-brand-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : existing ? "Mettre à jour" : "Enregistrer l'angle"}
        </button>
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check size={14} strokeWidth={2} aria-hidden />
            Enregistré
          </span>
        )}
      </div>
    </form>
  );
}
