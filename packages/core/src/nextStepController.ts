import type { ProductCard } from "./schemas/productCard.js";
import type { BusinessFoundation } from "./schemas/businessFoundation.js";
import { isRealValue, hasRealValue } from "./utils/placeholders.js";
import { isVagueOnly } from "./utils/vaguePhrases.js";

// Раздел 18, ТЗ v3.0
export interface NextStep {
  id: string;
  question: string;
}

// ── Структурные типы ─────────────────────────────────────────────────────────

/** Раздел 7.1.2 ТЗ v9.1: узел плана — только логика применимости/заполненности, без контента ниши. */
export interface SetupPlanNodeStructure {
  id: string;
  /** Показывать этот узел только когда применимо (e.g. estimate_inputs — только при custom pricing). */
  isApplicable: (c: ProductCard) => boolean;
  /** Поле заполнено (непустое значение). */
  isFilled: (c: ProductCard) => boolean;
  /** Заполненное значение — не расплывчатая фраза ("всё включено" и т.п.). */
  isSpecificEnough: (c: ProductCard) => boolean;
}

/** Вопрос и пример для одного узла в конкретной нише. */
export interface NichePackNode {
  question: string;
  example: string;
}

/**
 * Пак контента для одной ниши.
 * keywords — подстроки (lowercase) для сопоставления с category + company_description.
 * nodes   — вопрос и пример для каждого id из SETUP_PLAN_STRUCTURE.
 */
export interface NichePack {
  id: string;
  keywords: readonly string[];
  nodes: Record<string, NichePackNode>;
}

// ── SETUP_PLAN_STRUCTURE — универсальная логика 11 узлов ────────────────────

export const SETUP_PLAN_STRUCTURE: SetupPlanNodeStructure[] = [
  {
    id: "service",
    isApplicable: () => true,
    isFilled: (c) => !!c.name,
    isSpecificEnough: (c) => !!c.name,
  },
  {
    id: "price",
    isApplicable: (c) => c.pricing_model !== "custom",
    isFilled: (c) => c.price !== undefined && c.price > 0,
    isSpecificEnough: (c) => c.price !== undefined && c.price > 0,
  },
  {
    id: "includes",
    isApplicable: () => true,
    isFilled: (c) => c.includes.length > 0,
    isSpecificEnough: (c) => c.includes.length > 0 && !isVagueOnly(c.includes),
  },
  {
    id: "excludes",
    isApplicable: () => true,
    isFilled: (c) => c.excludes.length > 0,
    isSpecificEnough: (c) => c.excludes.length > 0 && !isVagueOnly(c.excludes),
  },
  {
    id: "estimate_inputs",
    isApplicable: (c) => c.pricing_model === "custom",
    isFilled: (c) => c.estimate_inputs.length > 0,
    isSpecificEnough: (c) => c.estimate_inputs.length > 0,
  },
  {
    id: "scout_signals",
    isApplicable: () => true,
    isFilled: (c) => c.scout_search_signals.length > 0,
    isSpecificEnough: (c) => c.scout_search_signals.length > 0 && !isVagueOnly(c.scout_search_signals),
  },
  {
    id: "customer_segments",
    isApplicable: () => true,
    isFilled: (c) => c.customer_segments.length > 0,
    isSpecificEnough: (c) => c.customer_segments.length > 0,
  },
  {
    id: "geography",
    isApplicable: () => true,
    isFilled: (c) => c.geography.length > 0,
    isSpecificEnough: (c) => c.geography.length > 0,
  },
  {
    id: "scout_sources",
    isApplicable: () => true,
    isFilled: (c) => c.scout_sources.length > 0,
    isSpecificEnough: (c) => c.scout_sources.length > 0,
  },
  {
    id: "avi_questions",
    isApplicable: () => true,
    isFilled: (c) => c.avi_qualification_questions.length > 0,
    isSpecificEnough: (c) => c.avi_qualification_questions.length > 0 && !isVagueOnly(c.avi_qualification_questions),
  },
  {
    id: "handoff_rules",
    isApplicable: () => true,
    isFilled: (c) => c.handoff_to_human_rules.length > 0,
    isSpecificEnough: (c) => c.handoff_to_human_rules.length > 0,
  },
];

// ── NICHE_PACKS — контент по нишам ──────────────────────────────────────────

export const NICHE_PACKS: Record<string, NichePack> = {

  // Красота — Наращивание ногтей (ниша-эталон ТЗ v9.1)
  nail_extension: {
    id: "nail_extension",
    keywords: ["красота и уход", "наращивание", "маникюр", "педикюр", "ногт"],
    nodes: {
      service:          { question: "Как называется ваша услуга?",                                     example: "«Наращивание ногтей гелем»" },
      price:            { question: "Сколько стоит — фиксированная цена или зависит от формы/длины?",  example: "база 2500 ₽" },
      includes:         { question: "Что входит в базовую услугу?",                                    example: "снятие старого покрытия, опил формы, стерилизация инструментов, однотонное покрытие гель-лаком" },
      excludes:         { question: "Что оплачивается отдельно?",                                      example: "дизайн со стразами от 200 ₽/ноготь" },
      estimate_inputs:  { question: "Что нужно знать от клиента для точной цены?",                     example: "текущая длина, нужно ли снятие, форма, нужен ли дизайн" },
      scout_signals:    { question: "По каким словам вас ищут клиенты?",                               example: "«наращивание ногтей [район]», «нарощенные ногти цена [район]»" },
      customer_segments:{ question: "Кто ваш основной клиент?",                                        example: "женщины 25–40, многие на коррекцию каждые 3 недели" },
      geography:        { question: "В каком районе/у какого метро принимаете?",                        example: "«Москва, м. Новослободская»" },
      scout_sources:    { question: "Где вас чаще всего находят?",                                     example: "ВК-группы по красоте района, 2ГИС" },
      avi_questions:    { question: "Что Avi должен уточнить перед записью?",                          example: "дата, снятие старого покрытия, аллергия на материалы, форма ногтей" },
      handoff_rules:    { question: "Когда передавать диалог вам лично?",                              example: "сложный дизайн, жалоба, запрос скидки" },
    },
  },

  // Строительство — Монолитные работы
  monolithic_works: {
    id: "monolithic_works",
    keywords: ["монолит", "перекрытие", "армирование", "монолитные работы", "заливка бетона"],
    nodes: {
      service:          { question: "Как называется ваша услуга?",                                     example: "«Монолитные работы — перекрытия и фундаменты»" },
      price:            { question: "Сколько стоит — фиксированная цена или рассчитывается по объёму?",example: "от 8 000 ₽/м³" },
      includes:         { question: "Что входит в базовую услугу?",                                    example: "армирование, изготовление и монтаж опалубки, заливка бетона, вибрирование" },
      excludes:         { question: "Что оплачивается отдельно?",                                      example: "доставка бетона, аренда бетононасоса, аренда крана" },
      estimate_inputs:  { question: "Что нужно знать от клиента для расчёта цены?",                    example: "объём конструкции (м³), тип (перекрытие/колонна/фундамент), класс бетона" },
      scout_signals:    { question: "По каким словам вас ищут клиенты?",                               example: "«монолитные работы [город]», «залить перекрытие цена», «монолит под ключ»" },
      customer_segments:{ question: "Кто ваш основной клиент?",                                        example: "частные застройщики ИЖС, строительные подрядчики, девелоперы" },
      geography:        { question: "В каком городе/регионе работаете?",                               example: "«Москва и Московская область»" },
      scout_sources:    { question: "Где вас чаще всего находят?",                                     example: "Авито, Яндекс.Карты, строительные форумы, сарафанное радио" },
      avi_questions:    { question: "Что Avi должен уточнить перед записью?",                          example: "объём в м³, тип конструкции, сроки начала, наличие проекта" },
      handoff_rules:    { question: "Когда передавать диалог вам лично?",                              example: "смета от 500 000 ₽, работа с юридическими лицами, госконтракты" },
    },
  },

  // Строительство — Кладка
  masonry: {
    id: "masonry",
    keywords: ["кладк", "кирпич", "газоблок", "пеноблок", "блок кладк"],
    nodes: {
      service:          { question: "Как называется ваша услуга?",                                     example: "«Кладка кирпича и газоблока»" },
      price:            { question: "Сколько стоит — фиксированная цена или зависит от объёма?",       example: "от 1 500 ₽/м²" },
      includes:         { question: "Что входит в базовую услугу?",                                    example: "разметка, приготовление раствора, кладка, расшивка швов" },
      excludes:         { question: "Что оплачивается отдельно?",                                      example: "кирпич и раствор (материалы заказчика), подъём выше 2-го этажа" },
      estimate_inputs:  { question: "Что нужно знать от клиента для расчёта цены?",                    example: "площадь стен (м²), толщина кладки (1 кирпич / 0.5 кирпича), тип материала" },
      scout_signals:    { question: "По каким словам вас ищут клиенты?",                               example: "«кладка кирпича [город]», «кирпичная кладка цена за м²»" },
      customer_segments:{ question: "Кто ваш основной клиент?",                                        example: "частники ИЖС, строительные подрядчики, прорабы" },
      geography:        { question: "В каком городе/регионе работаете?",                               example: "«Москва и Московская область»" },
      scout_sources:    { question: "Где вас чаще всего находят?",                                     example: "Авито, 2ГИС, строительные чаты" },
      avi_questions:    { question: "Что Avi должен уточнить перед записью?",                          example: "объём (м²), тип и толщина кладки, материал — свой или заказчика?" },
      handoff_rules:    { question: "Когда передавать диалог вам лично?",                              example: "смета от 300 000 ₽, нестандартный кирпич, юридическое лицо" },
    },
  },

  // Обязательный fallback — нейтральные общие примеры без привязки к нише
  default: {
    id: "default",
    keywords: [],
    nodes: {
      service:          { question: "Как называется ваша услуга?",                                     example: "«Ремонт квартиры», «Юридическая консультация»" },
      price:            { question: "Сколько стоит услуга?",                                           example: "фиксированная цена или расчёт по смете" },
      includes:         { question: "Что входит в базовую услугу?",                                    example: "основные этапы работы, включённые материалы" },
      excludes:         { question: "Что оплачивается отдельно?",                                      example: "дополнительные материалы, доставка, срочность" },
      estimate_inputs:  { question: "Что нужно знать от клиента для расчёта цены?",                    example: "объём работ, параметры объекта, сроки" },
      scout_signals:    { question: "По каким словам вас ищут клиенты?",                               example: "«[услуга] [город]», «[услуга] цена»" },
      customer_segments:{ question: "Кто ваш основной клиент?",                                        example: "физические лица, малый бизнес" },
      geography:        { question: "В каком городе/регионе работаете?",                               example: "«ваш город или район»" },
      scout_sources:    { question: "Где вас чаще всего находят?",                                     example: "Авито, 2ГИС, Яндекс, рекомендации" },
      avi_questions:    { question: "Что Avi должен уточнить перед записью?",                          example: "дата, объём задачи, особые требования" },
      handoff_rules:    { question: "Когда передавать диалог вам лично?",                              example: "крупные заказы, юридические лица, сложные случаи" },
    },
  },
};

// ── Вспомогательные функции ──────────────────────────────────────────────────

/**
 * Выбирает пак по category и company_description тенанта.
 * Без совпадения — возвращает default (никогда не блокирует).
 */
export function resolveNichePack(card?: ProductCard, foundation?: BusinessFoundation): NichePack {
  const text = [
    (card?.category ?? ""),
    (card?.name ?? ""),
    ((foundation?.company_description as string | undefined) ?? ""),
  ].join(" ").toLowerCase();
  for (const pack of Object.values(NICHE_PACKS)) {
    if (pack.id === "default") continue;
    if (pack.keywords.some((k) => text.includes(k))) return pack;
  }
  return NICHE_PACKS.default;
}

// ── Публичные типы плана ─────────────────────────────────────────────────────

export type NodeStatus = "done" | "current" | "upcoming" | "skipped";

export interface SetupPlanItem {
  id: string;
  question: string;
  example: string;
  status: NodeStatus;
}

// Backward-compat: SetupPlanNode с question/example (nail_extension pack) + структурные методы.
export interface SetupPlanNode extends SetupPlanNodeStructure {
  question: string;
  example: string;
}

// Backward-compat export — совмещает структуру + пак nail_extension (для тестов, которые импортируют SETUP_PLAN).
export const SETUP_PLAN: SetupPlanNode[] = SETUP_PLAN_STRUCTURE.map((node) => ({
  ...node,
  question: NICHE_PACKS.nail_extension.nodes[node.id].question,
  example:  NICHE_PACKS.nail_extension.nodes[node.id].example,
}));

// ── Внутренняя логика ────────────────────────────────────────────────────────

function computePlan(card: ProductCard, pack: NichePack): SetupPlanItem[] {
  let foundCurrent = false;
  return SETUP_PLAN_STRUCTURE.map((node) => {
    const content = pack.nodes[node.id] ?? NICHE_PACKS.default.nodes[node.id];
    if (!node.isApplicable(card)) {
      return { id: node.id, question: content.question, example: content.example, status: "skipped" as NodeStatus };
    }
    const done = node.isFilled(card) && node.isSpecificEnough(card);
    if (done) {
      return { id: node.id, question: content.question, example: content.example, status: "done" as NodeStatus };
    }
    if (!foundCurrent) {
      foundCurrent = true;
      return { id: node.id, question: content.question, example: content.example, status: "current" as NodeStatus };
    }
    return { id: node.id, question: content.question, example: content.example, status: "upcoming" as NodeStatus };
  });
}

// ── Публичные функции ─────────────────────────────────────────────────────────

export function computeNextStep(card: ProductCard | undefined, pack?: NichePack): NextStep | undefined {
  const resolvedPack = pack ?? (card ? resolveNichePack(card) : NICHE_PACKS.default);
  if (!card) return { id: "service", question: resolvedPack.nodes.service.question };
  const current = computePlan(card, resolvedPack).find((n) => n.status === "current");
  return current ? { id: current.id, question: current.question } : undefined;
}

export function computeReadiness(card: ProductCard, pack?: NichePack): {
  readiness_score: number;
  missing_fields: string[];
  plan: SetupPlanItem[];
} {
  const resolvedPack = pack ?? resolveNichePack(card);
  const plan = computePlan(card, resolvedPack);
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

/** Единственный источник истины при выборе «лучшей» карточки — не хранимое поле, а live computeReadiness(). */
export function pickBestCard(cards: ProductCard[]): ProductCard | undefined {
  if (cards.length === 0) return undefined;
  return cards.reduce((best, c) =>
    computeReadiness(c).readiness_score > computeReadiness(best).readiness_score ? c : best
  );
}

/**
 * Проверяет, готов ли профиль к переходу A→B (раздел 7.1.2 ТЗ v9.1):
 *   • хотя бы одна ProductCard с readiness_score >= 80 (вычисляется через computeReadiness)
 *   • лучшая карточка содержит scout_search_signals (Scout без них не работает)
 *   • BusinessFoundation содержит company_description, market_type и geography
 */
export function checkProfileReadyForDailyAssistant(
  cards: ProductCard[],
  foundation: BusinessFoundation | undefined,
): boolean {
  if (cards.length === 0) return false;
  const bestCard = pickBestCard(cards)!;
  const { readiness_score } = computeReadiness(bestCard);
  if (readiness_score < 80) return false;
  if (bestCard.scout_search_signals.length === 0) return false;
  if (!isRealValue(foundation?.company_description)) return false;
  if (!foundation?.market_type) return false;
  if (!hasRealValue(foundation?.geography)) return false;
  return true;
}
