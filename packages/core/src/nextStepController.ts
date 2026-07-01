import type { ProductCard } from "./schemas/productCard.js";
import type { BusinessFoundation } from "./schemas/businessFoundation.js";
import { isRealValue, hasRealValue } from "./utils/placeholders.js";
import { isVagueOnly } from "./utils/vaguePhrases.js";

// Раздел 18, ТЗ v3.0 — таблица приоритетов без изменений по сути.
export interface NextStep {
  id: string;
  question: string;
}

// Раздел 7.1.2 ТЗ v9.1: явный порядок вопросов Profile Setup.
// scout_signals стоит ПОСЛЕ estimate_inputs и ДО customer_segments — это минимум для запуска Scout.
// Без scout_search_signals Scout не может искать клиентов вообще, поэтому поле приоритетно.
//
// isVagueOnly: расплывчатый-only ответ (["всё включено"]) не считается заполненным полем —
// модель должна дожать конкретику (раздел 7.1.2 ТЗ v9.1, Фаза 2).
const PRIORITY_CHECKS: Array<{ id: string; check: (c: ProductCard) => boolean; question: string }> = [
  { id: "service", check: (c) => !c.name, question: "Какую услугу или продукт настроим?" },
  // При custom pricing цену не спрашиваем — нужны estimate_inputs (параметры расчёта).
  { id: "price", check: (c) => c.price === undefined && c.pricing_model !== "custom", question: "Как считается цена?" },
  { id: "includes", check: (c) => c.includes.length === 0 || isVagueOnly(c.includes), question: "Что входит в услугу?" },
  { id: "excludes", check: (c) => c.excludes.length === 0 || isVagueOnly(c.excludes), question: "Что оплачивается отдельно?" },
  { id: "estimate_inputs", check: (c) => c.estimate_inputs.length === 0, question: "Какие данные нужны от клиента для расчёта?" },
  // КРИТИЧНОЕ ПОЛЕ для Scout — без него поиск невозможен (раздел 7.1.2 ТЗ v9.1).
  { id: "scout_signals", check: (c) => c.scout_search_signals.length === 0 || isVagueOnly(c.scout_search_signals), question: "По каким словам вас обычно ищут клиенты?" },
  { id: "customer_segments", check: (c) => c.customer_segments.length === 0, question: "Кто основной клиент?" },
  { id: "geography", check: (c) => c.geography.length === 0, question: "В каком городе/регионе искать клиентов?" },
  { id: "scout_sources", check: (c) => c.scout_sources.length === 0, question: "В каких источниках искать?" },
  { id: "avi_questions", check: (c) => c.avi_qualification_questions.length === 0 || isVagueOnly(c.avi_qualification_questions), question: "Что Avi должен уточнять у клиента?" },
  { id: "handoff_rules", check: (c) => c.handoff_to_human_rules.length === 0, question: "Когда передавать человеку?" },
];

export function computeNextStep(card: ProductCard | undefined): NextStep | undefined {
  if (!card) return { id: "service", question: PRIORITY_CHECKS[0].question };
  for (const { id, check, question } of PRIORITY_CHECKS) {
    if (check(card)) return { id, question };
  }
  return undefined; // раздел 18, приоритет 12: "Ничего" — карточка готова
}

export function computeReadiness(card: ProductCard): { readiness_score: number; missing_fields: string[] } {
  const missing = PRIORITY_CHECKS.filter((c) => c.check(card)).map((c) => c.id);
  // Раздел 22.4 ТЗ: readiness_score=100 тогда и только тогда, когда missing_fields пуст.
  const readiness_score = missing.length === 0 ? 100 : Math.max(0, 100 - missing.length * (100 / PRIORITY_CHECKS.length));
  return { readiness_score: Math.round(readiness_score), missing_fields: missing };
}

/**
 * Проверяет, готов ли профиль к переходу A→B (раздел 7.1.2 ТЗ v9.1):
 *   • хотя бы одна ProductCard с readiness_score >= 80
 *   • лучшая карточка содержит scout_search_signals (иначе Scout не может искать ничего)
 *   • BusinessFoundation содержит company_description, market_type и geography
 */
export function checkProfileReadyForDailyAssistant(
  cards: ProductCard[],
  foundation: BusinessFoundation | undefined,
): boolean {
  if (cards.length === 0) return false;
  const bestCard = cards.reduce((best, c) => c.readiness_score > best.readiness_score ? c : best);
  if (bestCard.readiness_score < 80) return false;
  // Scout не может работать без ключевых слов поиска — жёсткое условие перехода.
  if (bestCard.scout_search_signals.length === 0) return false;
  // Placeholder-значения не засчитываются — тот же фильтр, что в isFoundationComplete.
  if (!isRealValue(foundation?.company_description)) return false;
  if (!foundation?.market_type) return false;
  if (!hasRealValue(foundation?.geography)) return false;
  return true;
}
