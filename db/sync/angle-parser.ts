// Optional, fully configurable ad-name parsing for creative_angles. No
// naming convention is hardcoded — Guillaume hasn't settled on one yet
// (see the request that scoped this file). The operator supplies a JS
// regex with named capture groups via AD_NAME_ANGLE_PATTERN; whichever of
// `category`/`label`/`hook`/`format` groups the pattern captures get used,
// the rest stay null. No pattern set = parsing disabled entirely.

export interface ParsedAngle {
  angleCategory: string | null;
  angleLabel: string;
  hookExcerpt: string | null;
  format: string | null;
}

/**
 * Returns undefined when parsing is disabled, the pattern is invalid, the
 * name doesn't match, or no `label` group was captured (angle_label is
 * required — a partial match with no label isn't a usable angle). Callers
 * must treat undefined as "leave this ad untagged, available for manual
 * entry later" — never invent a default category.
 */
export function parseAdNameForAngle(adName: string, pattern: string | undefined): ParsedAngle | undefined {
  if (!pattern) return undefined;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (error) {
    console.warn(
      `[sync] AD_NAME_ANGLE_PATTERN is not a valid regex (${error instanceof Error ? error.message : error}) — angle parsing disabled for this run.`,
    );
    return undefined;
  }

  const match = adName.match(regex);
  const groups = match?.groups;
  if (!groups) return undefined;

  const angleLabel = groups.label?.trim();
  if (!angleLabel) return undefined;

  return {
    angleCategory: groups.category?.trim() || null,
    angleLabel,
    hookExcerpt: groups.hook?.trim() || null,
    format: groups.format?.trim() || null,
  };
}
