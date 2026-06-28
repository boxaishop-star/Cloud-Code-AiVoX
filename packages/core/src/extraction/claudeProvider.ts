// TODO: pricing_model enum содержит "per_m3", специфичный для строительства —
// рассмотреть переименование в более общий формат (например per_unit + поле unit)
// при следующей доработке схемы, не сейчас.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionContext, ExtractionProvider, ExtractionResult } from './types.js';
import type { ToolAction } from '../schemas/toolAction.js';

const TOOL_NAME = 'extract_business_intent';

// All product-card payload fields that must be string arrays — used in the JSON schema
// (so the model generates arrays) and in coerceToArray post-processing (defensive layer).
const ARRAY_PAYLOAD_FIELDS = [
  'geography',
  'customer_segments',
  'includes',
  'excludes',
  'estimate_inputs',
  'scout_search_signals',
  'scout_sources',
  'avi_qualification_questions',
  'handoff_to_human_rules',
  'variants',
  'price_rules',
] as const;

/** Wraps a string in an array; passes arrays through unchanged; returns undefined for null/undefined. */
export function coerceToArray(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') return [value];
  return undefined;
}

const STRING_ARRAY = { type: 'array', items: { type: 'string' } };

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Extract business intent and proposed actions from a user message for the business assistant system.',
  input_schema: {
    type: 'object',
    required: ['intent', 'confidence', 'proposed_actions'],
    properties: {
      intent: {
        type: 'string',
        description: 'Business intent classification (e.g. business_setup, product_update, inquiry)',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Extraction confidence between 0 and 1',
      },
      proposed_actions: {
        type: 'array',
        description: 'Proposed business actions to execute',
        items: {
          type: 'object',
          required: ['type', 'payload'],
          properties: {
            type: {
              type: 'string',
              enum: [
                'upsert_business_foundation',
                'upsert_product_card',
                'update_product_card',
                'create_relationship_card',
                'update_relationship_card',
                'create_scout_job',
                'update_scout_settings',
                'update_avi_profile',
                'attach_material',
                'parse_document',
                'create_handoff',
              ],
            },
            payload: {
              type: 'object',
              description: 'Action payload (tenant_id is injected by the system)',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                category: { type: 'string' },
                service_line: { type: 'string' },
                pricing_model: {
                  type: 'string',
                  enum: ['per_m3', 'fixed', 'from_price', 'custom'],
                },
                price: { type: 'number' },
                unit: { type: 'string' },
                currency: { type: 'string' },
                geography: STRING_ARRAY,
                customer_segments: STRING_ARRAY,
                includes: STRING_ARRAY,
                excludes: STRING_ARRAY,
                estimate_inputs: STRING_ARRAY,
                scout_search_signals: STRING_ARRAY,
                scout_sources: STRING_ARRAY,
                avi_qualification_questions: STRING_ARRAY,
                handoff_to_human_rules: STRING_ARRAY,
                variants: STRING_ARRAY,
                price_rules: STRING_ARRAY,
              },
            },
          },
        },
      },
      next_step: {
        type: 'object',
        required: ['id', 'question'],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
        },
        description: 'Optional follow-up clarification to request from the user',
      },
    },
  },
};

export class ClaudeExtractionProvider implements ExtractionProvider {
  private client: Anthropic;
  private readonly model = 'claude-haiku-4-5-20251001';

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required');
    this.client = new Anthropic({ apiKey });
  }

  async extract(userMessage: string, context: ExtractionContext): Promise<ExtractionResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      system: buildSystemPrompt(context),
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawBlock = response.content.find((b) => b.type === 'tool_use');
    if (!rawBlock) throw new Error('Expected tool_use block in Claude response');

    const raw = (rawBlock as { input: Record<string, unknown> }).input as {
      intent: string;
      confidence: number;
      proposed_actions: Array<{ type: string; payload: Record<string, unknown> }>;
      next_step?: { id: string; question: string };
    };

    const proposed_actions = (raw.proposed_actions ?? []).map((a) => {
      const payload: Record<string, unknown> = { ...a.payload, tenant_id: context.tenant_id };
      // Defensive: coerce any scalar string to [string] for all known array fields.
      // Handles model non-determinism even when the JSON schema hint is ignored.
      for (const field of ARRAY_PAYLOAD_FIELDS) {
        if (field in payload) {
          const coerced = coerceToArray(payload[field]);
          if (coerced !== undefined) {
            payload[field] = coerced;
          } else {
            delete payload[field];
          }
        }
      }
      return { ...a, payload };
    }) as ToolAction[];

    return {
      intent: raw.intent,
      confidence: raw.confidence,
      proposed_actions,
      next_step: raw.next_step,
    };
  }
}

function buildSystemPrompt(context: ExtractionContext): string {
  const foundation =
    Object.keys(context.businessFoundation).length > 0
      ? JSON.stringify(context.businessFoundation, null, 2)
      : '(empty)';
  const catalog =
    context.productCatalog.length > 0
      ? JSON.stringify(context.productCatalog, null, 2)
      : '(empty)';

  const lines: string[] = [
    'You are a business-setup assistant for small businesses in Russia.',
    'User messages are written in Russian — this is expected and normal, NOT a parsing error.',
    'The system serves any industry: beauty, repair, consulting, construction, food, etc.',
    '',
    '## Your task',
    'Analyse the user message and call extract_business_intent with:',
    '  • intent     — choose ONE:',
    '      "business_setup"  — user is describing/adding a service that is NOT yet in the product catalog',
    '      "product_update"  — user is enriching a service that ALREADY exists in the product catalog below',
    '      "inquiry"         — user asks a question without setting up a service',
    '      "small_talk"      — greeting or off-topic',
    '  • confidence — 0–1',
    '  • proposed_actions — list of actions to execute (see rules below)',
    '  • next_step  — optional follow-up question ONLY to enrich an already-created card',
    '',
    '## Rule: create upsert_product_card immediately on first mention of a service',
    'Do NOT wait for a "complete" description. Do NOT replace the action with a next_step question.',
    'If the user mentions any service or product (even briefly), output upsert_product_card NOW.',
    '',
    '### Required payload fields for upsert_product_card (all five are mandatory):',
    '  id            — snake_case latin slug, e.g. "manicure_classic", "laptop_repair", "tax_consult"',
    '  name          — service name as the user stated it (in Russian if they used Russian)',
    '  category      — infer from context if not explicit; e.g. "Красота и уход", "Ремонт техники",',
    '                  "Юридические услуги", "Строительство", "Общественное питание"',
    '  service_line  — same value as id',
    '  pricing_model — pick the closest: "fixed" (per visit/item/hour), "from_price" (starting price),',
    '                  "per_m3" (volume-based, e.g. concrete), "custom" (complex/negotiated)',
    '',
    '### Optional payload fields — fill only when the user explicitly provided the value.',
    '### IMPORTANT: geography, customer_segments, includes, excludes, and all other list fields',
    '### MUST be arrays of strings, e.g. ["Москва"] not "Москва".',
    '  price, unit, currency,',
    '  includes[]                — what is included in price',
    '  excludes[]                — what is NOT included',
    '  estimate_inputs[]         — inputs needed to estimate price',
    '  customer_segments[]       — target customer groups',
    '  geography[]               — regions/cities served',
    '  scout_search_signals[]    — keywords for lead search',
    '  scout_sources[]           — channels to search leads in',
    '  avi_qualification_questions[] — questions Avi asks to qualify leads',
    '  handoff_to_human_rules[]  — rules for escalating to a human',
    '',
    '### Examples across different industries',
    '',
    'Example 1 — Beauty (short message):',
    '  User: "Делаю маникюр, цена 1500 рублей"',
    '  → proposed_actions: [{ "type": "upsert_product_card", "payload": {',
    '      "id": "manicure_classic", "name": "Классический маникюр",',
    '      "category": "Красота и уход", "service_line": "manicure_classic",',
    '      "pricing_model": "fixed", "price": 1500, "currency": "RUB" } }]',
    '',
    'Example 2 — Tech repair (price range, geography as array):',
    '  User: "Ремонт ноутбуков от 500 рублей, работаем в Москве и Питере"',
    '  → proposed_actions: [{ "type": "upsert_product_card", "payload": {',
    '      "id": "laptop_repair", "name": "Ремонт ноутбука",',
    '      "category": "Ремонт техники", "service_line": "laptop_repair",',
    '      "pricing_model": "from_price", "price": 500, "currency": "RUB",',
    '      "geography": ["Москва", "Санкт-Петербург"] } }]',
    '',
    'Example 3 — Consulting (no price given):',
    '  User: "Консультирую ИП по налогам"',
    '  → proposed_actions: [{ "type": "upsert_product_card", "payload": {',
    '      "id": "tax_consult_ip", "name": "Консультация по налогам для ИП",',
    '      "category": "Юридические и финансовые услуги", "service_line": "tax_consult_ip",',
    '      "pricing_model": "custom" } }]',
    '',
    '## IMPORTANT',
    '  • Never include tenant_id in the payload — the system injects it automatically.',
    '  • next_step is for enriching details AFTER the card exists, not instead of creating it.',
    '  • If unsure about category or pricing_model — make a reasonable inference; do not skip.',
    '',
    '---',
    `Tenant: ${context.tenant_id}`,
  ];

  if (context.activeServiceLine) lines.push(`Active service line: ${context.activeServiceLine}`);
  if (context.activeFactId) lines.push(`Active fact ID: ${context.activeFactId}`);

  lines.push(
    '',
    'Business foundation:',
    foundation,
    '',
    `Product catalog (${context.productCatalog.length} items):`,
    catalog,
  );

  return lines.join('\n');
}
