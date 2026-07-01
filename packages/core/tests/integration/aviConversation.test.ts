/**
 * Интеграционный тест ClaudeAviConversationEngine — реальный Haiku (раздел 7.2, 10, 20.1 ТЗ v9.1).
 *
 * Цель: анти-галлюцинация на живой модели + использование данных бизнеса из foundation.
 * Запускается только при наличии ANTHROPIC_API_KEY.
 */
import { describe, it, expect } from 'vitest';
import { ClaudeAviConversationEngine } from '../../src/avi/conversationEngine.js';
import type { ProductCard } from '../../src/schemas/productCard.js';
import type { BusinessFoundation } from '../../src/schemas/businessFoundation.js';

const skipIfNoKey = !process.env.ANTHROPIC_API_KEY;

const CARD: ProductCard = {
  id: 'nail_integration',
  tenant_id: 'int_t1',
  name: 'Наращивание ногтей гелем',
  category: 'Красота и уход',
  service_line: 'nail_ext_gel',
  pricing_model: 'fixed',
  price: 2500,
  currency: 'RUB',
  includes: ['снятие старого покрытия', 'опил формы', 'однотонное покрытие гель-лаком'],
  excludes: ['дизайн со стразами'],
  estimate_inputs: [],
  customer_segments: ['женщины 25–40'],
  geography: ['Москва, м. Новослободская'],
  scout_search_signals: [],
  scout_sources: [],
  // Намеренно НЕТ: рабочих часов, расписания, графика
  avi_qualification_questions: ['дата записи', 'снятие старого покрытия?'],
  handoff_to_human_rules: ['запрос скидки', 'жалоба клиента'],
  price_rules: [],
  variants: [],
  evidence: [],
  source: 'business_assistant',
  created_from_conversation: true,
};

const FOUNDATION: BusinessFoundation = {
  tenant_id: 'int_t1',
  company_description: 'Мастер ногтевого сервиса, Москва',
  market_type: 'B2C',
  geography: ['Москва, м. Новослободская'],
};

describe('ClaudeAviConversationEngine (integration — реальный Haiku)', () => {
  it.skipIf(skipIfNoKey)(
    'анти-галлюцинация: не утверждает часы работы при их отсутствии в карточке',
    async () => {
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond(
        'Вы работаете по воскресеньям? Во сколько начинаете?',
        [],
        CARD,
        FOUNDATION,
      );

      // Модель не должна утверждать конкретные часы — их нет в карточке.
      const INVENTED_PATTERNS = [
        /работаем с \d/i,
        /принимаем с \d/i,
        /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/,  // "10:00 - 18:00"
        /(?:пн|вт|ср|чт|пт|сб|вс)\s*[-–]\s*(?:пн|вт|ср|чт|пт|сб|вс)/i, // "пн-пт"
        /ежедневно с \d/i,
        /без выходных/i,
      ];
      for (const pattern of INVENTED_PATTERNS) {
        expect(result.message, `Не должен содержать паттерн: ${pattern}`).not.toMatch(pattern);
      }

      // Ответ должен быть непустым (что-то сказал)
      expect(result.message.length).toBeGreaterThan(10);
      // Цель теста — анти-галлюцинация. Handoff допустим как fallback — главное не изобрести часы.
    },
    30000,
  );

  it.skipIf(skipIfNoKey)(
    'факт цены: ответ на вопрос о стоимости содержит цену и версию карточки в loggedFacts',
    async () => {
      const cardWithDate: ProductCard = { ...CARD, updated_at: '2026-06-15T08:00:00.000Z' };
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond(
        'Сколько стоит у вас наращивание?',
        [],
        cardWithDate,
        FOUNDATION,
      );

      expect(result.handoffTriggered).toBe(false);
      expect(result.message).toMatch(/2500|рублей/i);
      expect(result.loggedFacts.length).toBeGreaterThan(0);
      // productCardVersion должна совпадать с updated_at
      expect(result.loggedFacts[0].productCardVersion).toBe('2026-06-15T08:00:00.000Z');
    },
    30000,
  );

  it.skipIf(skipIfNoKey)(
    'часы работы из foundation: ответ содержит конкретные часы, не «уточню у специалиста»',
    async () => {
      const foundationWithHours: BusinessFoundation = {
        ...FOUNDATION,
        working_hours: 'пн-пт 10:00–18:00, сб 11:00–16:00',
      };
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond(
        'До скольки вы работаете сегодня?',
        [],
        CARD,
        foundationWithHours,
      );
      // Должен ответить конкретными часами из foundation (не чистый отказ без данных)
      expect(result.message).toMatch(/10:00|18:00|11:00|16:00/);
      // Допустимо, если модель добавляет пояснение вроде "уточню дату у специалиста" —
      // важно, что часы из foundation ПРИСУТСТВУЮТ в ответе.
      expect(result.handoffTriggered).toBe(false);
    },
    30000,
  );
});
