import type { ProductCard } from "./schemas/productCard.js";

// Раздел 18, ТЗ v3.0 — таблица приоритетов без изменений по сути.
export interface NextStep {
  id: string;
  question: string;
}

const PRIORITY_CHECKS: Array<{ id: string; check: (c: ProductCard) => boolean; question: string }> = [
  { id: "service", check: (c) => !c.name, question: "Какую услугу или продукт настроим?" },
  { id: "price", check: (c) => c.price === undefined, question: "Как считается цена?" },
  { id: "includes", check: (c) => c.includes.length === 0, question: "Что входит в услугу?" },
  { id: "excludes", check: (c) => c.excludes.length === 0, question: "Что оплачивается отдельно?" },
  { id: "estimate_inputs", check: (c) => c.estimate_inputs.length === 0, question: "Какие данные нужны от клиента для расчёта?" },
  { id: "customer_segments", check: (c) => c.customer_segments.length === 0, question: "Кто основной клиент?" },
  { id: "geography", check: (c) => c.geography.length === 0, question: "В каком городе/регионе искать клиентов?" },
  { id: "scout_signals", check: (c) => c.scout_search_signals.length === 0, question: "По каким признакам искать спрос?" },
  { id: "scout_sources", check: (c) => c.scout_sources.length === 0, question: "В каких источниках искать?" },
  { id: "avi_questions", check: (c) => c.avi_qualification_questions.length === 0, question: "Что Avi должен уточнять у клиента?" },
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
