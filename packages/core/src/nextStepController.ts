import type { ProductCard } from "./schemas/productCard.js";
import type { BusinessFoundation } from "./schemas/businessFoundation.js";
import { isRealValue, hasRealValue } from "./utils/placeholders.js";
import { isVagueOnly } from "./utils/vaguePhrases.js";

// Раздел 18, ТЗ v3.0 — таблица приоритетов без изменений по сути.
export interface NextStep {
  id: string;
  question: string;
}

// Раздел 7.1.2 ТЗ v9.1 — узел плана настройки карточки.
export interface SetupPlanNode {
  id: string;
  question: string;
  /** Конкретный пример заполнения поля (ниша Красота / Наращивание ногтей). */
  example: string;
  /** Показывать этот узел только когда применимо (e.g. estimate_inputs — только при custom pricing). */
  isApplicable: (c: ProductCard) => boolean;
  /** Поле заполнено (непустое значение). */
  isFilled: (c: ProductCard) => boolean;
  /** Заполненное значение — не расплывчатая фраза ("всё включено" и т.п.). */
  isSpecificEnough: (c: ProductCard) => boolean;
}

export type NodeStatus = "done" | "current" | "upcoming" | "skipped";

export interface SetupPlanItem {
  id: string;
  question: string;
  example: string;
  status: NodeStatus;
}

// Раздел 7.1.2 ТЗ v9.1: явный порядок вопросов Profile Setup.
// Ниша-эталон: Красота / «Наращивание ногтей» (зафиксировано в ТЗ, не выдумывать заново).
// scout_signals стоит после estimate_inputs и до customer_segments — минимум для Scout.
export const SETUP_PLAN: SetupPlanNode[] = [
  {
    id: "service",
    question: "Как называется ваша услуга?",
    example: "«Наращивание ногтей гелем»",
    isApplicable: () => true,
    isFilled: (c) => !!c.name,
    isSpecificEnough: (c) => !!c.name,
  },
  {
    id: "price",
    // При custom pricing цену не спрашиваем — нужны estimate_inputs.
    question: "Сколько стоит — фиксированная цена или зависит от формы/длины?",
    example: "база 2500 ₽",
    isApplicable: (c) => c.pricing_model !== "custom",
    isFilled: (c) => c.price !== undefined && c.price > 0,
    isSpecificEnough: (c) => c.price !== undefined && c.price > 0,
  },
  {
    id: "includes",
    question: "Что входит в базовую услугу?",
    example: "снятие старого покрытия, опил формы, стерилизация инструментов, однотонное покрытие гель-лаком",
    isApplicable: () => true,
    isFilled: (c) => c.includes.length > 0,
    isSpecificEnough: (c) => c.includes.length > 0 && !isVagueOnly(c.includes),
  },
  {
    id: "excludes",
    question: "Что оплачивается отдельно?",
    example: "дизайн со стразами от 200 ₽/ноготь",
    isApplicable: () => true,
    isFilled: (c) => c.excludes.length > 0,
    isSpecificEnough: (c) => c.excludes.length > 0 && !isVagueOnly(c.excludes),
  },
  {
    id: "estimate_inputs",
    // Только для custom pricing — нужны параметры для расчёта цены.
    question: "Что нужно знать от клиента для точной цены?",
    example: "текущая длина, нужно ли снятие, форма, нужен ли дизайн",
    isApplicable: (c) => c.pricing_model === "custom",
    isFilled: (c) => c.estimate_inputs.length > 0,
    isSpecificEnough: (c) => c.estimate_inputs.length > 0,
  },
  {
    id: "scout_signals",
    // КРИТИЧНОЕ ПОЛЕ — без него Scout не может искать клиентов вообще.
    question: "По каким словам вас ищут клиенты?",
    example: "«наращивание ногтей [район]», «нарощенные ногти цена [район]»",
    isApplicable: () => true,
    isFilled: (c) => c.scout_search_signals.length > 0,
    isSpecificEnough: (c) => c.scout_search_signals.length > 0 && !isVagueOnly(c.scout_search_signals),
  },
  {
    id: "customer_segments",
    question: "Кто ваш основной клиент?",
    example: "женщины 25–40, многие на коррекцию каждые 3 недели",
    isApplicable: () => true,
    isFilled: (c) => c.customer_segments.length > 0,
    isSpecificEnough: (c) => c.customer_segments.length > 0,
  },
  {
    id: "geography",
    question: "В каком районе/у какого метро принимаете?",
    example: "«Москва, м. Новослободская»",
    isApplicable: () => true,
    isFilled: (c) => c.geography.length > 0,
    isSpecificEnough: (c) => c.geography.length > 0,
  },
  {
    id: "scout_sources",
    question: "Где вас чаще всего находят?",
    example: "ВК-группы по красоте района, 2ГИС",
    isApplicable: () => true,
    isFilled: (c) => c.scout_sources.length > 0,
    isSpecificEnough: (c) => c.scout_sources.length > 0,
  },
  {
    id: "avi_questions",
    question: "Что Avi должен уточнить перед записью?",
    example: "дата, снятие старого покрытия, аллергия на материалы, форма ногтей",
    isApplicable: () => true,
    isFilled: (c) => c.avi_qualification_questions.length > 0,
    isSpecificEnough: (c) => c.avi_qualification_questions.length > 0 && !isVagueOnly(c.avi_qualification_questions),
  },
  {
    id: "handoff_rules",
    question: "Когда передавать диалог вам лично?",
    example: "сложный дизайн, жалоба, запрос скидки",
    isApplicable: () => true,
    isFilled: (c) => c.handoff_to_human_rules.length > 0,
    isSpecificEnough: (c) => c.handoff_to_human_rules.length > 0,
  },
];

/** Производит массив статусов узлов: done / current / upcoming / skipped. */
function computePlan(card: ProductCard): SetupPlanItem[] {
  let foundCurrent = false;
  return SETUP_PLAN.map((node) => {
    if (!node.isApplicable(card)) {
      return { id: node.id, question: node.question, example: node.example, status: "skipped" as NodeStatus };
    }
    const done = node.isFilled(card) && node.isSpecificEnough(card);
    if (done) {
      return { id: node.id, question: node.question, example: node.example, status: "done" as NodeStatus };
    }
    if (!foundCurrent) {
      foundCurrent = true;
      return { id: node.id, question: node.question, example: node.example, status: "current" as NodeStatus };
    }
    return { id: node.id, question: node.question, example: node.example, status: "upcoming" as NodeStatus };
  });
}

export function computeNextStep(card: ProductCard | undefined): NextStep | undefined {
  if (!card) return { id: "service", question: SETUP_PLAN[0].question };
  const current = computePlan(card).find((n) => n.status === "current");
  return current ? { id: current.id, question: current.question } : undefined;
}

export function computeReadiness(card: ProductCard): {
  readiness_score: number;
  missing_fields: string[];
  plan: SetupPlanItem[];
} {
  const plan = computePlan(card);
  const applicableNodes = plan.filter((n) => n.status !== "skipped");
  const doneNodes = plan.filter((n) => n.status === "done");
  const missing_fields = plan
    .filter((n) => n.status === "current" || n.status === "upcoming")
    .map((n) => n.id);
  const readiness_score = applicableNodes.length === 0
    ? 100
    : doneNodes.length === applicableNodes.length
      ? 100
      : Math.max(0, Math.round((doneNodes.length / applicableNodes.length) * 100));
  return { readiness_score, missing_fields, plan };
}

/**
 * Проверяет, готов ли профиль к переходу A→B (раздел 7.1.2 ТЗ v9.1):
 *   • хотя бы одна ProductCard с readiness_score >= 80
 *   • лучшая карточка содержит scout_search_signals (Scout без них не работает)
 *   • BusinessFoundation содержит company_description, market_type и geography
 *   Placeholder-значения не засчитываются (utils/placeholders.ts).
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
