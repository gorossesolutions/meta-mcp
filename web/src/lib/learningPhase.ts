// adsets_snapshot.learning_status_normalized has exactly 5 possible values
// (db/README.md "Conventions") — handled explicitly, never a fallback
// "erreur"/blank. not_delivering is the most common case on Guillaume's
// current accounts (paused campaigns) and must read as neutral, not broken.

export type LearningPhaseStatus = "learning" | "success" | "failed" | "not_delivering" | "unknown";

export interface LearningPhaseDisplay {
  label: string;
  /** Tailwind classes for a small status pill. */
  className: string;
  /** True for "actively stabilizing, be careful" states — drives the visual distinction the brief asks for. */
  isLearning: boolean;
}

const DISPLAY: Record<LearningPhaseStatus, LearningPhaseDisplay> = {
  learning: {
    label: "En apprentissage",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    isLearning: true,
  },
  success: {
    label: "Stabilisé",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    isLearning: false,
  },
  failed: {
    label: "Apprentissage échoué",
    className: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
    isLearning: true,
  },
  not_delivering: {
    label: "Ne diffuse pas",
    className: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300",
    isLearning: false,
  },
  unknown: {
    label: "Valeur inattendue",
    className: "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
    isLearning: true,
  },
};

const KNOWN = new Set<LearningPhaseStatus>(["learning", "success", "failed", "not_delivering", "unknown"]);

export function getLearningPhaseDisplay(normalized: string | null | undefined): LearningPhaseDisplay {
  if (normalized && KNOWN.has(normalized as LearningPhaseStatus)) {
    return DISPLAY[normalized as LearningPhaseStatus];
  }
  // Defensive fallback for a value this frontend has never seen either —
  // still never "erreur", still visible as something worth checking.
  return DISPLAY.unknown;
}
