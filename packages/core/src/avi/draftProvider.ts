import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { RelationshipCard } from '../schemas/relationshipCard.js';
import type { ProductCard } from '../schemas/productCard.js';
import type { BusinessFoundation } from '../schemas/businessFoundation.js';

export interface DraftProvider {
  draft(
    card: RelationshipCard,
    productCard: ProductCard | undefined,
    foundation: BusinessFoundation | undefined,
  ): Promise<{ message: string }>;
}

const TOOL_NAME = 'generate_draft_message';

const DRAFT_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Generate a short, warm, natural first outreach message for a potential lead.',
  input_schema: {
    type: 'object' as const,
    required: ['message'],
    properties: {
      message: {
        type: 'string',
        description:
          '1–3 sentences. Warm and natural, in Russian. Engage on the topic the lead cares about. No corporate tone. No salesy phrases. Do not start with "Здравствуйте". Do NOT phrase the message as confirming you saw their post or have been watching them.',
      },
    },
  },
};

export class ClaudeDraftProvider implements DraftProvider {
  private client: Anthropic;
  private readonly model = 'claude-haiku-4-5-20251001';

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required');
    this.client = new Anthropic({ apiKey });
  }

  async draft(
    card: RelationshipCard,
    productCard: ProductCard | undefined,
    foundation: BusinessFoundation | undefined,
  ): Promise<{ message: string }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      system: buildSystemPrompt(foundation),
      messages: [{ role: 'user', content: buildUserContext(card, productCard) }],
    });

    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block) throw new Error('Expected tool_use block in Claude draft response');
    const input = (block as { input: Record<string, unknown> }).input;
    return { message: String(input.message) };
  }
}

function buildSystemPrompt(foundation: BusinessFoundation | undefined): string {
  const lines = [
    'You are Avi — an AI assistant that writes first outreach messages on behalf of a small business owner.',
    'Rules:',
    '  • Language: Russian only.',
    '  • Tone: warm, human, 1–3 sentences.',
    '  • Write as the business owner, not as an AI.',
    '  • NEVER reveal you are AI or mention "Avi".',
    '  • FACTS ONLY: every specific detail in the message (price, location, hours, included services, etc.) MUST come verbatim from the Business context or offer fields below. Do not add any marketing claims, advantages, or details not explicitly present in the provided data — even if they seem plausible.',
    '  • Do NOT phrase the message as confirming you have seen the lead\'s specific post or have been watching them. Do NOT use constructions like "видел, что ты", "заметил твой пост", "вижу, что ты ищешь" or any equivalent. Write as a natural topic-relevant introduction, not as surveillance confirmation.',
    '  • NO INVENTED AVAILABILITY: do not assert any specific time availability — no "завтра", "сегодня", "прямо сейчас", "свежее место", "уже есть слот", "запишем сразу" or any claim that a specific slot exists. If the data contains no structured availability information, the message may only invite the lead to discuss a convenient time — never assert it.',
    '',
  ];

  if (foundation) {
    lines.push('## Business context');
    if (foundation.company_description) lines.push(`Description: ${foundation.company_description}`);
    if (foundation.industry) lines.push(`Industry: ${foundation.industry}`);
    if (foundation.offer) lines.push(`Core offer: ${foundation.offer}`);
    if (foundation.geography?.length) lines.push(`Location: ${foundation.geography.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

function buildUserContext(card: RelationshipCard, productCard: ProductCard | undefined): string {
  const parts: string[] = ['## Lead signal'];

  if (card.detected_need) parts.push(`What they said / need: ${card.detected_need}`);
  if (card.source) parts.push(`Source: ${card.source}`);
  if (card.channel) parts.push(`Channel: ${card.channel}`);
  if (card.location) parts.push(`Location: ${card.location}`);

  if (productCard) {
    parts.push('', '## Our relevant offer');
    parts.push(`Service: ${productCard.name}`);
    if (productCard.price != null) {
      const suffix = productCard.unit ? ` / ${productCard.unit}` : '';
      parts.push(`Price: ${productCard.price} ${productCard.currency}${suffix}`);
    }
    if (productCard.includes.length) {
      parts.push(`Includes: ${productCard.includes.join(', ')}`);
    }
    if (productCard.description) {
      parts.push(`Details: ${productCard.description}`);
    }
  }

  parts.push('', 'Write the first outreach message using generate_draft_message.');
  return parts.join('\n');
}
