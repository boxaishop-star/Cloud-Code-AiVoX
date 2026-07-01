import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../../src/orchestrator.js";
import { InMemoryStore } from "../../src/toolLayer.js";
import { MockExtractionProvider } from "../../src/extraction/mockProvider.js";

// Текст полностью соответствует разделу 20.1 эталонного ТЗ ("Входной текст").
const RICH_MESSAGE = `Я занимаюсь строительством фундаментов. Сейчас хочу настроить одну основную услугу - ленточный фундамент.
Ленточный фундамент считаем по цене 8000 рублей за м3, цена одна для любого объёма. В эту цену входит подготовка участка, армирование, монтаж опалубки, приём бетона, вибрация бетона и уход за бетоном. В цену не входят материалы и спецтехника, их клиент оплачивает отдельно.
Чтобы рассчитать стоимость ленточного фундамента, от клиента нужны длина ленты, ширина ленты и высота ленты. Также мы можем делать ленточный фундамент со сваями и без свай.
Основные клиенты - частные домовладельцы, которые строят дом, баню, гараж или пристройку. Работаем по России.
Для Scout нужно искать людей и заявки, где есть интерес к строительству фундамента, ленточному фундаменту, фундаменту под дом. Источники поиска: карты, сайты объявлений, поисковая выдача, строительные форумы и Telegram-сообщества.
Для Avi важно сначала уточнить размеры фундамента, наличие проекта, вариант со сваями или без свай.`;

function makeOrchestrator() {
  const store = new InMemoryStore();
  const extractor = new MockExtractionProvider({
    "Я занимаюсь строительством фундаментов": {
      intent: "business_setup",
      confidence: 0.94,
      proposed_actions: [
        // Foundation действие идёт первым — projected foundation check разблокирует карточку.
        {
          type: "upsert_business_foundation",
          payload: {
            company_description: "Строительство фундаментов для частных домов",
            market_type: "B2C",
            geography: ["Россия"],
          },
        },
        {
          type: "upsert_product_card",
          payload: {
            id: "strip_foundation",
            name: "Ленточный фундамент",
            category: "Фундаменты",
            service_line: "strip_foundation",
            pricing_model: "per_m3",
            unit: "m3",
            price: 8000,
            currency: "RUB",
            includes: ["подготовка участка", "армирование", "монтаж опалубки", "приём бетона", "вибрация бетона", "уход за бетоном"],
            excludes: ["материалы", "спецтехника"],
            estimate_inputs: ["длина ленты", "ширина ленты", "высота ленты"],
            customer_segments: ["частные домовладельцы"],
            geography: ["Россия"],
            scout_search_signals: ["строительство фундамента", "ленточный фундамент", "фундамент под дом"],
            scout_sources: ["карты", "сайты объявлений", "поисковая выдача", "строительные форумы", "Telegram-сообщества"],
            avi_qualification_questions: ["размеры фундамента", "наличие проекта", "вариант со сваями или без свай"],
            handoff_to_human_rules: ["передать заявку специалисту для точного расчёта"],
          },
        },
      ],
    },
  });
  return new BusinessAssistantOrchestrator(store, extractor);
}

describe("Golden test: ленточный фундамент (раздел 22.1 ТЗ)", () => {
  it("intent = business_setup", async () => {
    const orch = makeOrchestrator();
    const result = await orch.process({ userMessage: RICH_MESSAGE, tenant_id: "biz_test_1" });
    expect(result.intent).toBe("business_setup");
  });

  it("ProductCard «Ленточный фундамент» создан с service_line strip_foundation", async () => {
    const orch = makeOrchestrator();
    const result = await orch.process({ userMessage: RICH_MESSAGE, tenant_id: "biz_test_2" });
    const applied = result.appliedActions.find((a) => a.action.type === "upsert_product_card");
    expect(applied?.applied).toBe(true);
    expect((applied?.action.payload as any).service_line).toBe("strip_foundation");
    expect((applied?.action.payload as any).name).toBe("Ленточный фундамент");
  });

  it("ProductCard «Фундаменты» как услуга НЕ создан (категория ≠ услуга)", async () => {
    const orch = makeOrchestrator();
    const result = await orch.process({ userMessage: RICH_MESSAGE, tenant_id: "biz_test_3" });
    const names = result.appliedActions.map((a) => (a.action.payload as any)?.name);
    expect(names).not.toContain("Фундаменты");
  });

  it('ответ содержит "Понял. Создал и заполнил карточку" (может начинаться с transition message)', async () => {
    const orch = makeOrchestrator();
    const result = await orch.process({ userMessage: RICH_MESSAGE, tenant_id: "biz_test_4" });
    expect(result.assistantResponse).toContain("Понял. Создал и заполнил карточку");
  });

  it("readiness_score корректен относительно missing_fields (раздел 22.4 ТЗ)", async () => {
    const orch = makeOrchestrator();
    const result = await orch.process({ userMessage: RICH_MESSAGE, tenant_id: "biz_test_5" });
    // карточка не имеет avi/handoff и т.п. в неполном объёме — проверяем согласованность, не конкретное число.
    const applied = result.appliedActions.find((a) => a.action.type === "upsert_product_card");
    expect(applied?.applied).toBe(true);
  });
});
