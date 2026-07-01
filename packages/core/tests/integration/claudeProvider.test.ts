import { describe, it, expect } from 'vitest';
import { ClaudeExtractionProvider } from '../../src/extraction/claudeProvider.js';
import { NICHE_PACKS } from '../../src/nextStepController.js';

// Текст из раздела 20.1 эталонного ТЗ
const RICH_MESSAGE = `Я занимаюсь строительством фундаментов. Сейчас хочу настроить одну основную услугу - ленточный фундамент.
Ленточный фундамент считаем по цене 8000 рублей за м3, цена одна для любого объёма. В эту цену входит подготовка участка, армирование, монтаж опалубки, приём бетона, вибрация бетона и уход за бетоном. В цену не входят материалы и спецтехника, их клиент оплачивает отдельно.
Чтобы рассчитать стоимость ленточного фундамента, от клиента нужны длина ленты, ширина ленты и высота ленты. Также мы можем делать ленточный фундамент со сваями и без свай.
Основные клиенты - частные домовладельцы, которые строят дом, баню, гараж или пристройку. Работаем по России.
Для Scout нужно искать людей и заявки, где есть интерес к строительству фундамента, ленточному фундаменту, фундаменту под дом. Источники поиска: карты, сайты объявлений, поисковая выдача, строительные форумы и Telegram-сообщества.
Для Avi важно сначала уточнить размеры фундамента, наличие проекта, вариант со сваями или без свай.`;

const skipIfNoKey = !process.env.ANTHROPIC_API_KEY;

describe('ClaudeExtractionProvider (integration)', () => {
  it.skipIf(skipIfNoKey)(
    'extracts business_setup intent from ленточный фундамент text (раздел 20.1 ТЗ)',
    async () => {
      const provider = new ClaudeExtractionProvider();
      const result = await provider.extract(RICH_MESSAGE, {
        tenant_id: 'integration_test_1',
        businessFoundation: {},
        productCatalog: [],
      });

      expect(result.intent).toBe('business_setup');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.proposed_actions.length).toBeGreaterThan(0);

      const productAction = result.proposed_actions.find(
        (a) => a.type === 'upsert_product_card' || a.type === 'update_product_card',
      );
      expect(productAction).toBeDefined();
      expect((productAction!.payload as Record<string, unknown>).tenant_id).toBe(
        'integration_test_1',
      );
    },
    30000,
  );

  // ── Раздел 6, 7.1.2, 20.1 ТЗ v9.1: дожим на расплывчатый ответ ──────────────

  it.skipIf(skipIfNoKey)(
    'дожим на расплывчатость: "всё по договорённости" → proposed_actions пусты, clarification_text конкретен',
    async () => {
      const provider = new ClaudeExtractionProvider();
      const result = await provider.extract('всё по договорённости', {
        tenant_id: 'integration_vague_1',
        businessFoundation: {
          company_description: 'Монолитные работы — заливка перекрытий и фундаментов',
          market_type: 'B2C',
          geography: ['Москва и Московская область'],
        },
        productCatalog: [
          {
            id: 'monolith_works',
            name: 'Монолитные работы',
            category: 'Строительство',
            service_line: 'monolith_works',
            pricing_model: 'per_m3',
            price: 8000,
          },
        ],
        assistant_stage: 'profile_setup',
        missing_fields: ['includes'],
        foundationComplete: true,
        nichePack: NICHE_PACKS.monolithic_works,
      });

      // Модель должна отклонить расплывчатый ответ и попросить конкретику.
      expect(result.proposed_actions).toHaveLength(0);
      expect(result.clarification_text).toBeTruthy();
      // clarification_text должен содержать конкретный пример (не принять "по договорённости" как ответ).
      expect(result.clarification_text).not.toMatch(/по договорённости|по договоренности/i);
    },
    30000,
  );

  // ── Раздел 7.1.2, 25 ТЗ v9.1: bulk catalog creation ─────────────────────────

  it.skipIf(skipIfNoKey)(
    'bulk create: "все виды монолитных" → несколько upsert_product_card + clarification_text',
    async () => {
      const provider = new ClaudeExtractionProvider();
      const result = await provider.extract(
        'Занимаюсь всеми видами монолитных работ — фундаменты разных типов, дорожки, отмостки, армопояс, погреб',
        {
          tenant_id: 'integration_bulk_monolith',
          businessFoundation: {
            company_description: 'Монолитные работы — все виды бетонных конструкций',
            market_type: 'B2C',
            geography: ['Москва и Московская область'],
          },
          productCatalog: [],
          assistant_stage: 'profile_setup',
          missing_fields: [],
          foundationComplete: true,
          nichePack: NICHE_PACKS.monolithic_works,
        },
      );

      const cardActions = result.proposed_actions.filter(
        (a) => a.type === 'upsert_product_card' || a.type === 'update_product_card',
      );
      expect(cardActions.length).toBeGreaterThanOrEqual(3);
      expect(result.clarification_text).toBeTruthy();
      for (const action of cardActions) {
        expect((action.payload as Record<string, unknown>).category).toBe('Строительство');
      }
    },
    30000,
  );

  // ── Раздел 6 ТЗ v9.1: изоляция ниш на реальном Claude ───────────────────────

  it.skipIf(skipIfNoKey)(
    'изоляция ниш: masonry-пак → clarification_text не содержит nail-специфичных слов',
    async () => {
      const provider = new ClaudeExtractionProvider();
      const result = await provider.extract('всё по договорённости', {
        tenant_id: 'integration_masonry_isolation',
        businessFoundation: {
          company_description: 'Кладка кирпича и газоблока',
          market_type: 'B2C',
          geography: ['Москва'],
        },
        productCatalog: [
          {
            id: 'masonry_works',
            name: 'Кладка кирпича',
            category: 'Строительство',
            service_line: 'masonry_works',
            pricing_model: 'fixed',
            price: 1500,
          },
        ],
        assistant_stage: 'profile_setup',
        missing_fields: ['includes'],
        foundationComplete: true,
        nichePack: NICHE_PACKS.masonry,
      });

      // Если модель генерирует clarification_text — он не должен содержать nail-слова.
      if (result.clarification_text) {
        expect(result.clarification_text).not.toMatch(/ноготь|гель-лак|опил формы|стразы|маникюр/i);
      }
      // В любом случае proposed_actions не должны содержать vague-фразу как значение.
      for (const action of result.proposed_actions) {
        const payload = action.payload as Record<string, unknown>;
        const includes = payload.includes as string[] | undefined;
        if (includes) {
          expect(includes).not.toContain('по договорённости');
          expect(includes).not.toContain('по договоренности');
        }
      }
    },
    30000,
  );
});
