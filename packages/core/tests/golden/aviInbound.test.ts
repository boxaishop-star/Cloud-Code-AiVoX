/**
 * Golden test: AviConversationEngine — входящие сообщения (раздел 7.2 ТЗ v9.1).
 *
 * Детерминированная часть (мок) — проверяет:
 *   • структуру AviResponse и форматирование loggedFacts
 *   • versioning: productCardVersion = updated_at ?? id
 *   • buildAviSystemPrompt: наличие цены, handoff-правил, запрет выдумок
 *
 * Поведенческая часть (реальный Haiku, it.skipIf) — проверяет:
 *   (а) вопрос по цене → факт из карточки залогирован
 *   (б) вопрос вне карточки → не выдумывает конкретные данные
 *   (в) вопрос под handoff_rule → handoffTriggered=true, без утечки цены
 */
import { describe, it, expect } from 'vitest';
import {
  MockAviConversationEngine,
  ClaudeAviConversationEngine,
  buildAviSystemPrompt,
} from '../../src/avi/conversationEngine.js';
import type { ProductCard } from '../../src/schemas/productCard.js';
import type { BusinessFoundation } from '../../src/schemas/businessFoundation.js';

const VALID_FIELDS = [
  'price',
  'includes',
  'excludes',
  'estimate_inputs',
  'geography',
  'customer_segments',
  'avi_qualification_questions',
] as const;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CARD: ProductCard = {
  id: 'nail_avi_test',
  tenant_id: 't1',
  name: 'Наращивание ногтей гелем',
  category: 'Красота и уход',
  service_line: 'nail_ext_gel',
  pricing_model: 'fixed',
  price: 2500,
  currency: 'RUB',
  includes: ['снятие старого покрытия', 'опил формы', 'стерилизация инструментов', 'однотонное покрытие гель-лаком'],
  excludes: ['дизайн со стразами от 200 ₽/ноготь'],
  estimate_inputs: [],
  customer_segments: ['женщины 25–40'],
  geography: ['Москва, м. Новослободская'],
  scout_search_signals: [],
  scout_sources: [],
  avi_qualification_questions: ['дата записи', 'снятие старого покрытия?', 'аллергия на материалы?'],
  handoff_to_human_rules: ['жалоба клиента', 'сложный дизайн', 'запрос скидки'],
  price_rules: [],
  variants: [],
  evidence: [],
  source: 'business_assistant',
  created_from_conversation: true,
};

const FOUNDATION: BusinessFoundation = {
  tenant_id: 't1',
  company_description: 'Мастер по наращиванию ногтей гелем, Москва',
  market_type: 'B2C',
  geography: ['Москва, м. Новослободская'],
};

// ── Детерминированные тесты (мок) ─────────────────────────────────────────────

describe('Golden Avi: структура AviResponse и versioning (детерминированные)', () => {
  const FIXTURES = {
    'Сколько стоит': {
      message: 'Наращивание ногтей гелем стоит 2500 ₽. Включено снятие, опил формы и покрытие гель-лаком.',
      loggedFacts: [{ field: 'price', value: '2500 RUB' }],
    },
    'В какое время': {
      message: 'Уточню этот вопрос у специалиста и напишу вам.',
      loggedFacts: [],
    },
    'скидку': {
      message: 'Передаю ваш вопрос — совсем скоро ответят.',
      handoffTriggered: true,
      handoffReason: 'запрос скидки',
      loggedFacts: [],
    },
  };

  it('(а) вопрос по цене: loggedFacts содержит price-факт с productCardVersion = id', async () => {
    const engine = new MockAviConversationEngine(FIXTURES);
    const result = await engine.respond('Сколько стоит наращивание?', [], BASE_CARD, FOUNDATION);

    expect(result.handoffTriggered).toBe(false);
    expect(result.message).toContain('2500');
    expect(result.loggedFacts).toHaveLength(1);
    expect(result.loggedFacts[0].field).toBe('price');
    expect(VALID_FIELDS as readonly string[]).toContain(result.loggedFacts[0].field);
    expect(result.loggedFacts[0].value).toContain('2500');
    // updated_at не задан → версия = id карточки
    expect(result.loggedFacts[0].productCardVersion).toBe(BASE_CARD.id);
  });

  it('(а) productCardVersion = updated_at когда поле задано', async () => {
    const cardWithDate: ProductCard = { ...BASE_CARD, updated_at: '2026-01-15T10:00:00.000Z' };
    const engine = new MockAviConversationEngine(FIXTURES);
    const result = await engine.respond('Сколько стоит наращивание?', [], cardWithDate, FOUNDATION);
    expect(result.loggedFacts[0].productCardVersion).toBe('2026-01-15T10:00:00.000Z');
  });

  it('(б) вопрос вне карточки: handoffTriggered=false, loggedFacts пуст', async () => {
    const engine = new MockAviConversationEngine(FIXTURES);
    const result = await engine.respond('В какое время вы принимаете?', [], BASE_CARD, FOUNDATION);

    expect(result.handoffTriggered).toBe(false);
    expect(result.loggedFacts).toHaveLength(0);
    // Не выдуман конкретный ответ про часы
    expect(result.message).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('(в) запрос скидки: handoffTriggered=true, handoffReason задан', async () => {
    const engine = new MockAviConversationEngine(FIXTURES);
    const result = await engine.respond('Дайте мне скидку пожалуйста', [], BASE_CARD, FOUNDATION);

    expect(result.handoffTriggered).toBe(true);
    expect(result.handoffReason).toBeTruthy();
    expect(result.loggedFacts).toHaveLength(0);
    // Цена не утекает в handoff-сообщение
    expect(result.message).not.toMatch(/2500|рублей/i);
  });

  it('неизвестное сообщение: fallback-ответ без facts', async () => {
    const engine = new MockAviConversationEngine(FIXTURES);
    const result = await engine.respond('Привет, хочу узнать про тебя', [], BASE_CARD, FOUNDATION);
    expect(result.handoffTriggered).toBe(false);
    expect(result.loggedFacts).toHaveLength(0);
  });
});

// ── Тесты промпта (детерминированные) ────────────────────────────────────────

describe('Golden Avi: buildAviSystemPrompt (детерминированные)', () => {
  it('промпт содержит цену из карточки', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION);
    expect(prompt).toContain('2500');
    expect(prompt).toContain('RUB');
  });

  it('промпт содержит включённые услуги', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION);
    expect(prompt).toContain('снятие старого покрытия');
    expect(prompt).toContain('стерилизация инструментов');
  });

  it('промпт содержит handoff_to_human_rules', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION);
    expect(prompt).toContain('запрос скидки');
    expect(prompt).toContain('жалоба клиента');
    expect(prompt).toContain('сложный дизайн');
  });

  it('промпт содержит запрет NO INVENTED AVAILABILITY', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION);
    expect(prompt).toContain('NO INVENTED AVAILABILITY');
  });

  it('промпт с пустыми handoff_rules: конкретные правила отсутствуют в промпте', () => {
    const cardNoHandoff: ProductCard = { ...BASE_CARD, handoff_to_human_rules: [] };
    const prompt = buildAviSystemPrompt(cardNoHandoff, FOUNDATION);
    // Конкретные правила BASE_CARD не должны попасть в промпт
    expect(prompt).not.toContain('жалоба клиента');
    expect(prompt).not.toContain('запрос скидки');
    expect(prompt).not.toContain('сложный дизайн');
  });

  it('промпт с custom pricing: нет числовой цены, есть «рассчитывается индивидуально»', () => {
    const customCard: ProductCard = { ...BASE_CARD, pricing_model: 'custom', price: undefined };
    const prompt = buildAviSystemPrompt(customCard, FOUNDATION);
    expect(prompt).toContain('рассчитывается индивидуально');
    expect(prompt).not.toContain('2500');
  });

  it('промпт содержит универсальное правило handoff на запрос звонка/встречи', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION);
    // Универсальное правило должно быть в промпте независимо от нишевых правил
    expect(prompt).toMatch(/позвон|перезвон/i);
    expect(prompt).toMatch(/встрет/i);
    expect(prompt).toMatch(/прямой контакт|человек.{0,20}мастер|мастер.{0,20}менеджер/i);
  });

  it('универсальное правило присутствует даже при пустых handoff_rules', () => {
    const cardNoHandoff: ProductCard = { ...BASE_CARD, handoff_to_human_rules: [] };
    const prompt = buildAviSystemPrompt(cardNoHandoff, FOUNDATION);
    expect(prompt).toMatch(/позвон|перезвон/i);
  });
});

// ── Тесты данных бизнеса из foundation (address/working_hours) ───────────────

describe('Golden Avi: buildAviSystemPrompt — данные бизнеса из foundation', () => {
  const FOUNDATION_WITH_DETAILS: BusinessFoundation = {
    ...FOUNDATION,
    company_name: 'Студия Ногтей',
    address: 'Москва, ул. Тверская, 15, оф. 3',
    working_hours: 'пн-пт 10:00–19:00, сб 11:00–17:00',
  };

  it('промпт содержит working_hours из foundation', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION_WITH_DETAILS);
    expect(prompt).toContain('пн-пт 10:00–19:00');
    expect(prompt).toContain('сб 11:00–17:00');
  });

  it('промпт содержит address из foundation', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION_WITH_DETAILS);
    expect(prompt).toContain('Тверская, 15');
  });

  it('промпт использует company_name как имя бизнеса', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION_WITH_DETAILS);
    expect(prompt).toContain('Студия Ногтей');
  });

  it('промпт без address/working_hours — секция не добавляется', () => {
    const prompt = buildAviSystemPrompt(BASE_CARD, FOUNDATION);
    expect(prompt).not.toContain('Адрес:');
    expect(prompt).not.toContain('Режим работы:');
  });

  it.skipIf(skipIfNoKey)(
    'реальный Haiku: «до скольки работаете?» → ответ из working_hours, не «уточню у специалиста»',
    async () => {
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond(
        'До скольки вы работаете сегодня?',
        [],
        BASE_CARD,
        FOUNDATION_WITH_DETAILS,
      );
      expect(result.message).toMatch(/10:00|19:00|11:00|17:00/);
      expect(result.message).not.toMatch(/уточню у специалиста/i);
      expect(result.handoffTriggered).toBe(false);
    },
    30000,
  );
});

// ── Тесты фиксов: универсальный handoff + нормализация field ─────────────────

describe('Golden Avi: универсальный handoff и нормализация logged_facts.field', () => {
  const FIXTURES_CALL = {
    'Сколько стоит': {
      message: 'Наращивание ногтей гелем стоит 2500 ₽.',
      loggedFacts: [{ field: 'price', value: '2500 RUB' }],
    },
    'позвонить': {
      message: 'Передаю ваш вопрос — совсем скоро ответят.',
      handoffTriggered: true,
      handoffReason: 'запрос прямого контакта',
      loggedFacts: [],
    },
  };

  // (а) — тест промпта: универсальное правило отражено в buildAviSystemPrompt
  it('(а) buildAviSystemPrompt: запрос звонка/встречи упомянут как универсальное handoff-правило', () => {
    // Карточка без нишевых handoff-правил — универсальное правило должно оставаться
    const cardNoRules: ProductCard = { ...BASE_CARD, handoff_to_human_rules: [] };
    const prompt = buildAviSystemPrompt(cardNoRules, FOUNDATION);
    expect(prompt).toMatch(/позвон|перезвон/i);
    expect(prompt).toMatch(/встрет/i);
  });

  // (б) — тест на нормализацию field: каждый fact.field строго из VALID_FIELDS
  it('(б) loggedFacts.field строго из допустимого enum (VALID_FIELDS)', async () => {
    const engine = new MockAviConversationEngine(FIXTURES_CALL);
    const result = await engine.respond('Сколько стоит наращивание?', [], BASE_CARD, FOUNDATION);
    expect(result.loggedFacts.length).toBeGreaterThan(0);
    for (const f of result.loggedFacts) {
      expect(VALID_FIELDS as readonly string[]).toContain(f.field);
    }
  });
});

// ── Поведенческие тесты на реальном Haiku ────────────────────────────────────

const skipIfNoKey = !process.env.ANTHROPIC_API_KEY;

describe('Golden Avi: поведение ClaudeAviConversationEngine (Haiku)', () => {
  it.skipIf(skipIfNoKey)(
    '(а) вопрос по цене → ответ содержит цену, в loggedFacts залогирован price-факт',
    async () => {
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond('Сколько стоит наращивание ногтей?', [], BASE_CARD, FOUNDATION);

      expect(result.handoffTriggered).toBe(false);
      // Цена должна быть упомянута
      expect(result.message).toMatch(/2500|рублей/i);
      // Факт должен быть залогирован
      expect(result.loggedFacts.length).toBeGreaterThan(0);
      const priceFact = result.loggedFacts.find(
        (f) => f.field === 'price' || f.value.includes('2500'),
      );
      expect(priceFact).toBeDefined();
      expect(priceFact!.productCardVersion).toBe(BASE_CARD.id);
    },
    30000,
  );

  it.skipIf(skipIfNoKey)(
    '(б) вопрос вне карточки → не изобретает часы работы',
    async () => {
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond('В какое время вы принимаете?', [], BASE_CARD, FOUNDATION);

      // Не должен придумывать конкретные часы работы
      expect(result.message).not.toMatch(/работаем с \d/i);
      expect(result.message).not.toMatch(/принимаем с \d/i);
      expect(result.message).not.toMatch(/\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/); // "10:00-18:00"
      expect(result.handoffTriggered).toBe(false);
    },
    30000,
  );

  it.skipIf(skipIfNoKey)(
    '(в) запрос скидки → handoffTriggered=true, цена не утекает в ответ',
    async () => {
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond('Можно ли получить скидку?', [], BASE_CARD, FOUNDATION);

      expect(result.handoffTriggered).toBe(true);
      // Цена не должна присутствовать в handoff-сообщении
      expect(result.message).not.toMatch(/2500|рублей/i);
      // loggedFacts пуст при handoff
      expect(result.loggedFacts).toHaveLength(0);
    },
    30000,
  );

  it.skipIf(skipIfNoKey)(
    '(г) «можете позвонить?» без совпадения с нишевыми правилами → universalhandoffTriggered=true',
    async () => {
      // Карточка без нишевых handoff-правил — только универсальное правило должно сработать
      const cardNoRules: ProductCard = { ...BASE_CARD, handoff_to_human_rules: [] };
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond('Можете позвонить мне?', [], cardNoRules, FOUNDATION);

      expect(result.handoffTriggered).toBe(true);
      expect(result.loggedFacts).toHaveLength(0);
    },
    30000,
  );

  it.skipIf(skipIfNoKey)(
    '(д) loggedFacts.field из реального Haiku — строго из VALID_FIELDS',
    async () => {
      const engine = new ClaudeAviConversationEngine();
      const result = await engine.respond('Сколько стоит наращивание ногтей?', [], BASE_CARD, FOUNDATION);

      expect(result.handoffTriggered).toBe(false);
      for (const f of result.loggedFacts) {
        expect(VALID_FIELDS as readonly string[]).toContain(f.field);
      }
    },
    30000,
  );
});
