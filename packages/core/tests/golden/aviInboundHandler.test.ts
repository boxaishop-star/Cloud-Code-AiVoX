import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../../src/toolLayer.js';
import { MockAviConversationEngine } from '../../src/avi/conversationEngine.js';
import type { AviConversationEngine, AviResponse } from '../../src/avi/conversationEngine.js';
import { handleAviInboundMessage } from '../../src/avi/inboundHandler.js';
import type { ProductCard } from '../../src/schemas/productCard.js';
import type { BusinessFoundation } from '../../src/schemas/businessFoundation.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-avi-test';

const CARD: ProductCard = {
  id: 'card-strip',
  tenant_id: TENANT,
  name: 'Ленточный фундамент',
  category: 'Строительство',
  service_line: 'strip_foundation',
  pricing_model: 'per_m3',
  price: 8000,
  currency: 'RUB',
  unit: 'м³',
  price_rules: [],
  includes: ['арматура', 'бетон М300'],
  excludes: [],
  estimate_inputs: ['длина', 'ширина', 'глубина'],
  variants: [],
  customer_segments: [],
  geography: ['Москва', 'МО'],
  scout_search_signals: [],
  scout_sources: [],
  avi_qualification_questions: ['Какая площадь объекта?'],
  handoff_to_human_rules: ['клиент хочет встретиться с прорабом'],
  readiness_score: 80,
  missing_fields: [],
  evidence: [],
  source: 'business_assistant',
  created_from_conversation: true,
};

const FOUNDATION: BusinessFoundation = {
  tenant_id: TENANT,
  assistant_stage: 'daily_assistant',
  company_description: 'Монолитные работы под ключ',
  geography: [],
  scout_geography: [],
};

function makeRequest(text: string, externalChatId = 'tg-chat-1') {
  return {
    tenantId: TENANT,
    channel: 'telegram',
    externalChatId,
    externalUserId: 'user-42',
    text,
    productCard: CARD,
    foundation: FOUNDATION,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('avi/inboundHandler — golden tests', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('первое сообщение создаёт RelationshipCard с source_tier=tier1', async () => {
    const engine = new MockAviConversationEngine({
      'привет': { message: 'Здравствуйте!', clientFacts: [] },
    });

    const result = await handleAviInboundMessage(makeRequest('привет'), store, engine);

    const rcs = await store.getRelationshipCards(TENANT);
    expect(rcs).toHaveLength(1);
    expect(rcs[0].source_tier).toBe('tier1');
    expect(rcs[0].legal_basis).toContain('клиент написал первым');
    expect(rcs[0].owner_agent).toBe('avi');
    expect(result.relationshipCardId).toBe(rcs[0].id);
  });

  it('имя и телефон → RelationshipCard.name/contact заполнены', async () => {
    const engine = new MockAviConversationEngine({
      'Меня зовут Артём': {
        message: 'Рады знакомству, Артём!',
        clientFacts: [
          { field: 'name', value: 'Артём' },
          { field: 'contact', value: '+79161234567' },
        ],
      },
    });

    await handleAviInboundMessage(makeRequest('Меня зовут Артём, мой телефон +79161234567'), store, engine);

    const rcs = await store.getRelationshipCards(TENANT);
    expect(rcs[0].name).toBe('Артём');
    expect(rcs[0].contact).toBe('+79161234567');
  });

  it('"хочу оформить заявку" → status=proposal_needed', async () => {
    const engine = new MockAviConversationEngine({
      'хочу оформить заявку': {
        message: 'Отлично! Давайте оформим.',
        funnelSignal: 'proposal_needed',
        clientFacts: [],
      },
    });

    const result = await handleAviInboundMessage(makeRequest('хочу оформить заявку'), store, engine);

    const rcs = await store.getRelationshipCards(TENANT);
    expect(rcs[0].status).toBe('proposal_needed');
    expect(result.response.funnelSignal).toBe('proposal_needed');
  });

  it('день рождения упоминается → birthday заполнено', async () => {
    const engine = new MockAviConversationEngine({
      'день рождения': {
        message: 'Поздравляем заранее!',
        clientFacts: [{ field: 'birthday', value: '1990-06-15' }],
      },
    });

    await handleAviInboundMessage(makeRequest('мой день рождения 15 июня'), store, engine);

    const rcs = await store.getRelationshipCards(TENANT);
    expect(rcs[0]).toHaveProperty('birthday', '1990-06-15');
  });

  it('день рождения НЕ заполнено если клиент не упоминал (regression)', async () => {
    const engine = new MockAviConversationEngine({
      'сколько стоит': {
        message: 'Цена 8000 руб/м³.',
        clientFacts: [],
      },
    });

    await handleAviInboundMessage(makeRequest('сколько стоит фундамент'), store, engine);

    const rcs = await store.getRelationshipCards(TENANT);
    expect(rcs[0].birthday).toBeUndefined();
  });

  it('вопрос без явного сигнала → funnelSignal отсутствует, status не меняется (regression раздел 4 ТЗ)', async () => {
    const engine = new MockAviConversationEngine({
      'подробнее': {
        message: 'Включает арматуру и бетон М300.',
        clientFacts: [],
        // funnelSignal намеренно отсутствует
      },
    });

    await handleAviInboundMessage(makeRequest('расскажите подробнее'), store, engine);

    const rcs = await store.getRelationshipCards(TENANT);
    expect(rcs[0].status).toBe('new');
    // Avi НЕ ставит funnel_signal когда намерение неоднозначно
    expect(rcs[0]).not.toHaveProperty('status', 'qualified');
  });

  it('handoffTriggered=true → conversation.status=needs_human', async () => {
    const engine = new MockAviConversationEngine({
      'встретиться с прорабом': {
        message: 'Передаю ваш вопрос — совсем скоро ответят',
        handoffTriggered: true,
        handoffReason: 'клиент хочет встретиться с прорабом',
        clientFacts: [],
      },
    });

    const result = await handleAviInboundMessage(makeRequest('хочу встретиться с прорабом'), store, engine);

    const conv = await store.findConversation(TENANT, 'telegram', 'tg-chat-1');
    expect(conv?.status).toBe('needs_human');
    expect(result.response.handoffTriggered).toBe(true);
  });

  it('история накапливается между вызовами', async () => {
    const engine = new MockAviConversationEngine({
      'первое': { message: 'Ответ 1', clientFacts: [] },
      'второе': { message: 'Ответ 2', clientFacts: [] },
    });

    await handleAviInboundMessage(makeRequest('первое сообщение'), store, engine);
    const result = await handleAviInboundMessage(makeRequest('второе сообщение'), store, engine);

    const messages = await store.getMessages(result.conversationId);
    // client(1) + avi(1) + client(2) + avi(2) = 4
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('client');
    expect(messages[0].text).toBe('первое сообщение');
    expect(messages[2].role).toBe('client');
    expect(messages[2].text).toBe('второе сообщение');
  });

  it('повторное сообщение использует существующую Conversation, не создаёт дублей RC', async () => {
    const engine = new MockAviConversationEngine({
      'msg': { message: 'ok', clientFacts: [] },
    });

    const r1 = await handleAviInboundMessage(makeRequest('msg1'), store, engine);
    const r2 = await handleAviInboundMessage(makeRequest('msg2'), store, engine);

    expect(r1.conversationId).toBe(r2.conversationId);
    expect(r1.relationshipCardId).toBe(r2.relationshipCardId);

    const rcs = await store.getRelationshipCards(TENANT);
    expect(rcs).toHaveLength(1);
  });

  // ── Раздел 4 ТЗ v9.1: Avi не отвечает после handoff ─────────────────────────

  it('после handoff: awaitingHuman=true, engine.respond() не вызывается', async () => {
    // Шаг А: сообщение триггерит handoff
    const handoffEngine = new MockAviConversationEngine({
      'встретиться': {
        message: 'Передаю ваш вопрос — совсем скоро ответят',
        handoffTriggered: true,
        handoffReason: 'клиент хочет встретиться с прорабом',
        clientFacts: [],
      },
    });
    await handleAviInboundMessage(makeRequest('хочу встретиться с прорабом'), store, handoffEngine);

    const conv = await store.findConversation(TENANT, 'telegram', 'tg-chat-1');
    expect(conv?.status).toBe('needs_human');

    // Шаг Б: engine, который бросает исключение если его позвали
    class ErrorIfCalledEngine implements AviConversationEngine {
      async respond(): Promise<AviResponse> {
        throw new Error('engine.respond() was called — must NOT happen after handoff (раздел 4 ТЗ)');
      }
    }

    const result = await handleAviInboundMessage(makeRequest('ещё одно сообщение'), store, new ErrorIfCalledEngine());

    expect(result.awaitingHuman).toBe(true);
    expect(result.response.message).toBe('');
    expect(result.response.handoffTriggered).toBe(true);
  });

  it('после handoff: сообщение клиента сохраняется в истории несмотря на отсутствие ответа', async () => {
    const handoffEngine = new MockAviConversationEngine({
      'встретиться': {
        message: 'Передаю ваш вопрос — совсем скоро ответят',
        handoffTriggered: true,
        clientFacts: [],
      },
    });
    const r1 = await handleAviInboundMessage(makeRequest('хочу встретиться'), store, handoffEngine);

    class SilentEngine implements AviConversationEngine {
      async respond(): Promise<AviResponse> {
        throw new Error('должен быть заглушён');
      }
    }

    const r2 = await handleAviInboundMessage(makeRequest('когда перезвонит мастер?'), store, new SilentEngine());

    const messages = await store.getMessages(r2.conversationId);
    // client(1) + avi(1) + client(2) = 3  (Avi-ответа нет, только client-сообщение)
    expect(messages).toHaveLength(3);
    const last = messages[messages.length - 1];
    expect(last.role).toBe('client');
    expect(last.text).toBe('когда перезвонит мастер?');
  });

  it('awaitingHuman=false в нормальном (не-handoff) ответе', async () => {
    const engine = new MockAviConversationEngine({
      'стоит': { message: 'Цена 8000 руб/м³.', clientFacts: [] },
    });

    const result = await handleAviInboundMessage(makeRequest('сколько стоит?'), store, engine);

    expect(result.awaitingHuman).toBe(false);
  });

  it('клиентские сообщения всегда сохраняются с logged_facts=[] (факты только в Avi-сообщении)', async () => {
    const engine = new MockAviConversationEngine({
      'арматура': {
        message: 'Включает арматуру и бетон М300.',
        loggedFacts: [{ field: 'includes', value: 'арматура' }],
        clientFacts: [],
      },
    });

    const result = await handleAviInboundMessage(makeRequest('что включает арматура'), store, engine);

    const messages = await store.getMessages(result.conversationId);
    const clientMsg = messages.find((m) => m.role === 'client');
    const aviMsg    = messages.find((m) => m.role === 'avi');

    expect(clientMsg?.logged_facts).toEqual([]);
    expect(aviMsg?.logged_facts).toHaveLength(1);
    expect((aviMsg?.logged_facts as Array<{field: string}>)[0].field).toBe('includes');
  });
});
