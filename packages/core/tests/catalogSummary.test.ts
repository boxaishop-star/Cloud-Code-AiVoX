import { describe, it, expect } from "vitest";
import {
  computeCatalogSummary,
  pickNextCardInQueue,
  NICHE_SERVICE_CATALOGS,
  NICHE_PACKS,
} from "../src/nextStepController.js";
import type { ProductCard } from "../src/schemas/productCard.js";

// Раздел 6, 7.1.2, 25 ТЗ v9.1: сводка каталожной очереди для правой панели.

function makeCard(overrides: Partial<ProductCard>): ProductCard {
  return {
    id: overrides.service_line ?? "card",
    tenant_id: "t",
    name: "Карточка",
    category: "Строительство",
    service_line: "unknown",
    pricing_model: "fixed",
    currency: "RUB",
    price_rules: [],
    includes: [],
    excludes: [],
    estimate_inputs: [],
    variants: [],
    customer_segments: [],
    geography: [],
    scout_search_signals: [],
    scout_sources: [],
    avi_qualification_questions: [],
    handoff_to_human_rules: [],
    evidence: [],
    source: "business_assistant",
    created_from_conversation: true,
    ...overrides,
  };
}

// Полностью заполненная карточка (readiness_score = 100 для monolithic_works pack).
const FULL_FOUNDATION_CARD: Partial<ProductCard> = {
  price: 8000,
  includes: ["армирование", "опалубка"],
  excludes: ["доставка бетона"],
  customer_segments: ["застройщики ИЖС"],
  geography: ["Москва"],
  scout_search_signals: ["монолитные работы москва"],
  scout_sources: ["Авито"],
  avi_qualification_questions: ["объём в м3"],
  handoff_to_human_rules: ["смета от 500000"],
};

describe("computeCatalogSummary", () => {
  const pack = NICHE_PACKS.monolithic_works;

  it("total и done считаются по всем cards, не только по активной карточке", () => {
    const doneCard = makeCard({ service_line: "strip_foundation", name: "Ленточный фундамент", ...FULL_FOUNDATION_CARD });
    const partialCard = makeCard({ service_line: "slab_foundation", name: "Плитный фундамент", price: 9000 });
    const emptyCard = makeCard({ service_line: "rostwerk", name: "Ростверк" });

    const summary = computeCatalogSummary([doneCard, partialCard, emptyCard], pack);

    expect(summary.total).toBe(3);
    expect(summary.done).toBe(1);
    expect(summary.cards).toHaveLength(3);
  });

  it("статус карточки — 'done' когда readiness_score = 100", () => {
    const doneCard = makeCard({ service_line: "strip_foundation", name: "Ленточный фундамент", ...FULL_FOUNDATION_CARD });
    const summary = computeCatalogSummary([doneCard], pack);
    expect(summary.cards[0].readiness_score).toBe(100);
    expect(summary.cards[0].status).toBe("done");
  });

  it("статус карточки — 'current' для activeCard, когда readiness_score < 100", () => {
    const partialCard = makeCard({ service_line: "slab_foundation", name: "Плитный фундамент", price: 9000 });
    const otherCard = makeCard({ service_line: "rostwerk", name: "Ростверк" });
    const summary = computeCatalogSummary([partialCard, otherCard], pack, partialCard);

    const active = summary.cards.find((c) => c.service_line === "slab_foundation")!;
    const other = summary.cards.find((c) => c.service_line === "rostwerk")!;
    expect(active.status).toBe("current");
    expect(other.status).toBe("upcoming");
  });

  it("без activeCard недозаполненные карточки получают статус 'upcoming'", () => {
    const partialCard = makeCard({ service_line: "slab_foundation", name: "Плитный фундамент", price: 9000 });
    const summary = computeCatalogSummary([partialCard], pack);
    expect(summary.cards[0].status).toBe("upcoming");
  });

  it("пустой список карточек → total=0, done=0, cards=[]", () => {
    const summary = computeCatalogSummary([], pack);
    expect(summary).toEqual({ total: 0, done: 0, cards: [] });
  });

  it("согласовано с pickNextCardInQueue: активная карточка каталога получает status='current'", () => {
    const catalog = NICHE_SERVICE_CATALOGS.monolithic_works;
    const doneCard = makeCard({ service_line: "strip_foundation", name: "Ленточный фундамент", ...FULL_FOUNDATION_CARD });
    const partialCard = makeCard({ service_line: "slab_foundation", name: "Плитный фундамент", price: 9000 });
    const cards = [doneCard, partialCard];

    const activeCard = pickNextCardInQueue(cards, catalog)!;
    expect(activeCard.service_line).toBe("slab_foundation");

    const summary = computeCatalogSummary(cards, pack, activeCard);
    expect(summary.cards.find((c) => c.service_line === "strip_foundation")?.status).toBe("done");
    expect(summary.cards.find((c) => c.service_line === "slab_foundation")?.status).toBe("current");
  });
});
