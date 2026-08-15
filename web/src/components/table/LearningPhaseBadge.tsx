import { getLearningPhaseDisplay } from "../../lib/learningPhase";

/**
 * Shows the normalized label with a clear visual marker for "still
 * learning, be careful" states, and the raw value in a tooltip so an
 * unexpected value from Meta (e.g. a real LEARNING_LIMITED — unconfirmed
 * as of docs/AUDIT.md) is visible, not hidden.
 */
export function LearningPhaseBadge({
  normalized,
  raw,
}: {
  normalized: string | null | undefined;
  raw: string | null | undefined;
}) {
  const display = getLearningPhaseDisplay(normalized);
  return (
    <span
      title={`Valeur brute Meta : ${raw ?? "(vide)"}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${display.className}`}
    >
      {display.isLearning && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {display.label}
    </span>
  );
}
