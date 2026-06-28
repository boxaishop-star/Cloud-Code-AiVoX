import { describe, it, expect } from 'vitest';
import { ClaudeExtractionProvider } from '../../src/extraction/claudeProvider.js';

// Текст из раздела 20.1 эталонного ТЗ
const RICH_MESSAGE = `Я занимаюсь строительством фундаментов. Сейчас хочу настроить одну основную услугу - ленточный фундамент.
Ленточный фундамент считаем по цене 8000 рублей за м3, цена одна для любого объёма. В эту цену входит подготовка участка, армирование, монтаж опалубки, приём бетона, вибрация бетона и уход за бетоном. В цену не входят материалы и спецтехника, их клиент оплачивает отдельно.
Чтобы рассчитать стоимость ленточного фундамента, от клиента нужны длина ленты, ширина ленты и высота ленты. Также мы можем делать ленточный фундамент со сваями и без свай.
Основные клиенты - частные домовладельцы, которые строят дом, баню, гараж или пристройку. Работаем по России.
Для Scout нужно искать людей и заявки, где есть интерес к строительству фундамента, ленточному фундаменту, фундаменту под дом. Источники поиска: карты, сайты объявлений, поисковая выдача, строительные форумы и Telegram-сообщества.
Для Avi важно сначала уточнить размеры фундамента, наличие проекта, вариант со сваями или без свай.`;

describe('ClaudeExtractionProvider (integration)', () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
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
});
