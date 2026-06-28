import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { createPrismaClient } from '../../src/db/client.js';
import { PostgresStore } from '../../src/db/postgresStore.js';
import { MockExtractionProvider } from '../../src/extraction/mockProvider.js';
import { BusinessAssistantOrchestrator } from '../../src/orchestrator.js';

// Текст полностью соответствует разделу 20.1 эталонного ТЗ ("Входной текст").
const RICH_MESSAGE = `Я занимаюсь строительством фундаментов. Сейчас хочу настроить одну основную услугу - ленточный фундамент.
Ленточный фундамент считаем по цене 8000 рублей за м3, цена одна для любого объёма. В эту цену входит подготовка участка, армирование, монтаж опалубки, приём бетона, вибрация бетона и уход за бетоном. В цену не входят материалы и спецтехника, их клиент оплачивает отдельно.
Чтобы рассчитать стоимость ленточного фундамента, от клиента нужны длина ленты, ширина ленты и высота ленты. Также мы можем делать ленточный фундамент со сваями и без свай.
Основные клиенты - частные домовладельцы, которые строят дом, баню, гараж или пристройку. Работаем по России.
Для Scout нужно искать людей и заявки, где есть интерес к строительству фундамента, ленточному фундаменту, фундаменту под дом. Источники поиска: карты, сайты объявлений, поисковая выдача, строительные форумы и Telegram-сообщества.
Для Avi важно сначала уточнить размеры фундамента, наличие проекта, вариант со сваями или без свай.`;

const TENANT_ID = 'test_orch_pg_' + Math.random().toString(36).slice(2, 8);

async function isDbAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  let client: ReturnType<typeof createPrismaClient> | undefined;
  try {
    client = createPrismaClient();
    // @ts-ignore — $queryRawUnsafe exists on Prisma 7 client
    await client.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    // @ts-ignore
    await client?.$disconnect().catch(() => {});
  }
}

function makeExtractor() {
  return new MockExtractionProvider({
    "Я занимаюсь строительством фундаментов": {
      intent: "business_setup",
      confidence: 0.94,
      proposed_actions: [
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
}

describe('BusinessAssistantOrchestrator + PostgresStore (раздел 20.1 ТЗ)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let store: PostgresStore;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) return;
    client = createPrismaClient();
    store = new PostgresStore(client);
  });

  afterAll(async () => {
    if (!dbAvailable || !client) return;
    await client.productCard.deleteMany({ where: { tenant_id: TENANT_ID } });
    await client.businessFoundation.deleteMany({ where: { tenant_id: TENANT_ID } });
    await client.$disconnect();
  });

  it('intent = business_setup', async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const orch = new BusinessAssistantOrchestrator(store, makeExtractor());
    const result = await orch.process({ userMessage: RICH_MESSAGE, tenant_id: TENANT_ID });
    expect(result.intent).toBe('business_setup');
  });

  it('ProductCard «Ленточный фундамент» записан в Postgres и читается обратно', async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const orch = new BusinessAssistantOrchestrator(store, makeExtractor());
    const result = await orch.process({ userMessage: RICH_MESSAGE, tenant_id: TENANT_ID });

    const applied = result.appliedActions.find((a) => a.action.type === 'upsert_product_card');
    expect(applied?.applied).toBe(true);
    expect((applied?.action.payload as any).service_line).toBe('strip_foundation');

    const cards = await store.getProductCards(TENANT_ID);
    expect(cards.some((c) => c.service_line === 'strip_foundation')).toBe(true);
    expect(cards.find((c) => c.service_line === 'strip_foundation')?.price).toBe(8000);
  });

  it('ответ начинается с "Понял. Создал и заполнил карточку"', async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const orch = new BusinessAssistantOrchestrator(store, makeExtractor());
    const result = await orch.process({ userMessage: RICH_MESSAGE, tenant_id: TENANT_ID });
    expect(result.assistantResponse.startsWith('Понял. Создал и заполнил карточку')).toBe(true);
  });
}, 30000);
