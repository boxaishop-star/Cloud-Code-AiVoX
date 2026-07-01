/**
 * Раздел 7.1.2 ТЗ v9.1 — единый фильтр placeholder-значений для обоих gate'ов:
 *   • isFoundationComplete (orchestrator.ts)  — gate создания ProductCard
 *   • checkProfileReadyForDailyAssistant (nextStepController.ts) — gate перехода A→B
 *
 * Хранится в одном месте, чтобы список placeholder'ов не расходился.
 */

export const PLACEHOLDER_VALUES = new Set([
  'unknown',
  '<unknown>',
  'не указано',
  '-',
  'n/a',
  'none',
  '?',
]);

/** Returns true if v is a non-empty string that is not a known placeholder. */
export function isRealValue(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return s.length > 0 && !PLACEHOLDER_VALUES.has(s.toLowerCase());
}

/**
 * Returns true if the array contains at least one real (non-placeholder) string.
 * An undefined/empty array returns false.
 */
export function hasRealValue(arr: string[] | undefined | null): boolean {
  if (!Array.isArray(arr)) return false;
  return arr.some(isRealValue);
}
