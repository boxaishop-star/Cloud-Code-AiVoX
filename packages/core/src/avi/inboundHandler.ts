import { randomUUID } from 'crypto';
import type { DataStore } from '../store.js';
import type { AviConversationEngine } from './conversationEngine.js';
import type { ProductCard } from '../schemas/productCard.js';
import type { BusinessFoundation } from '../schemas/businessFoundation.js';
import type { Conversation } from '../schemas/conversation.js';
import type { AviResponse } from './conversationEngine.js';

export interface AviInboundRequest {
  tenantId: string;
  channel: string;
  externalChatId: string;
  externalUserId: string;
  text: string;
  productCard: ProductCard;
  foundation: BusinessFoundation;
}

export interface AviInboundResult {
  conversationId: string;
  relationshipCardId: string;
  /** true = диалог ведёт человек, клиенту ничего отправлять не нужно */
  awaitingHuman: boolean;
  response: AviResponse;
}

export async function handleAviInboundMessage(
  request: AviInboundRequest,
  store: DataStore,
  engine: AviConversationEngine,
): Promise<AviInboundResult> {
  const { tenantId, channel, externalChatId, externalUserId, text, productCard, foundation } = request;
  const now = new Date().toISOString();

  // 1. Find or create Conversation
  let conversation = await store.findConversation(tenantId, channel, externalChatId);
  let relationshipCardId: string;

  if (!conversation) {
    const conversationId = randomUUID();
    relationshipCardId = randomUUID();

    // Create RelationshipCard on first message — tier1, legal_basis per раздел 12 ТЗ
    await store.applyAction({
      type: 'create_relationship_card',
      payload: {
        id: relationshipCardId,
        tenant_id: tenantId,
        type: 'lead',
        channel,
        source_tier: 'tier1',
        legal_basis: 'клиент написал первым напрямую через мессенджер площадки',
        owner_agent: 'avi',
        status: 'new',
      },
    });

    conversation = {
      id: conversationId,
      tenant_id: tenantId,
      channel,
      external_chat_id: externalChatId,
      external_user_id: externalUserId,
      relationship_card_id: relationshipCardId,
      status: 'active',
      created_at: now,
      updated_at: now,
    } satisfies Conversation;

    await store.saveConversation(conversation);
  } else {
    relationshipCardId = conversation.relationship_card_id!;
  }

  // 2. Guard: если диалог уже передан человеку — сохранить сообщение, но не звать Avi.
  // Раздел 4 ТЗ v9.1: Avi не должен отвечать автоматически после handoff.
  if (conversation.status === 'needs_human') {
    await store.saveMessage({
      id: randomUUID(),
      conversation_id: conversation.id,
      tenant_id: tenantId,
      role: 'client',
      text,
      logged_facts: [],
      created_at: now,
    });
    return {
      conversationId: conversation.id,
      relationshipCardId,
      awaitingHuman: true,
      response: { message: '', handoffTriggered: true, loggedFacts: [], clientFacts: [] },
    };
  }

  // 3. Load history and call engine
  const messages = await store.getMessages(conversation.id);
  const history = messages.map((m) => ({ role: m.role, text: m.text }));

  const aviResponse = await engine.respond(text, history, productCard, foundation);

  // 4. Save client message — logged_facts всегда пустые (факты приписываются только сообщению Avi)
  await store.saveMessage({
    id: randomUUID(),
    conversation_id: conversation.id,
    tenant_id: tenantId,
    role: 'client',
    text,
    logged_facts: [],
    created_at: now,
  });

  // 5. Save Avi message (logged_facts = SERVICE facts only)
  await store.saveMessage({
    id: randomUUID(),
    conversation_id: conversation.id,
    tenant_id: tenantId,
    role: 'avi',
    text: aviResponse.message,
    logged_facts: aviResponse.loggedFacts,
    created_at: now,
  });

  // 6. Apply clientFacts → RelationshipCard
  if (aviResponse.clientFacts.length > 0) {
    const patch: Record<string, unknown> = {};
    for (const fact of aviResponse.clientFacts) {
      if (fact.field === 'name')          patch.name = fact.value;
      else if (fact.field === 'contact')  patch.contact = fact.value;
      else if (fact.field === 'birthday') patch.birthday = fact.value;
      else if (fact.field === 'detected_need') patch.detected_need = fact.value;
    }
    await store.updateRelationshipCard(tenantId, relationshipCardId, patch);
  }

  // 7. Apply funnelSignal → RelationshipCard.status
  if (aviResponse.funnelSignal) {
    await store.updateRelationshipCard(tenantId, relationshipCardId, {
      status: aviResponse.funnelSignal,
    });
  }

  // 8. Handle handoff → conversation.status = needs_human
  if (aviResponse.handoffTriggered) {
    const updated: Conversation = { ...conversation, status: 'needs_human', updated_at: now };
    await store.saveConversation(updated);
  }

  return {
    conversationId: conversation.id,
    relationshipCardId,
    awaitingHuman: false,
    response: aviResponse,
  };
}
