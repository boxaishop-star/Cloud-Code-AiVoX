// TODO: pricing_model enum содержит "per_m3", специфичный для строительства —
// рассмотреть переименование в более общий формат (например per_unit + поле unit)
// при следующей доработке схемы, не сейчас.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionContext, ExtractionProvider, ExtractionResult } from './types.js';
import type { ToolAction } from '../schemas/toolAction.js';
import { NICHE_PACKS } from '../nextStepController.js';

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
      clarification_text: {
        type: 'string',
        description:
          'REQUIRED when proposed_actions is empty. Also REQUIRED after upsert_business_foundation when foundation is still incomplete. ' +
          'Write a SHORT (1-2 sentences), direct, conversational reply in Russian. ' +
          'STRICT: NO markdown — no **bold**, no *italic*, no bullet lists with - or *, no headers. ' +
          'Plain text ONLY. ' +
          'BAD: "**Понял!** Вот что нужно:\\n- Где работаете\\n- Кто клиенты" ' +
          'GOOD: "Понял. Подскажите, в каких городах вы работаете?" ' +
          'Address exactly what the user said — do not enumerate the whole catalog.',
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
      clarification_text?: string;
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
      clarification_text: raw.clarification_text,
    };
  }
}

export function buildSystemPrompt(context: ExtractionContext): string {
  const stage = context.assistant_stage ?? 'profile_setup';
  const foundation =
    Object.keys(context.businessFoundation).length > 0
      ? JSON.stringify(context.businessFoundation, null, 2)
      : '(empty)';
  const catalog =
    context.productCatalog.length > 0
      ? JSON.stringify(context.productCatalog, null, 2)
      : '(empty)';

  const lines: string[] = [
    'You are Business Assistant for small businesses in Russia.',
    'User messages are written in Russian — this is expected and normal, NOT a parsing error.',
    'The system serves any industry: beauty, repair, consulting, construction, food, etc.',
    '',
  ];

  const pack = context.nichePack ?? NICHE_PACKS.default;
  if (stage === 'daily_assistant') {
    buildDailyAssistantPrompt(lines, context, foundation, catalog);
  } else {
    buildProfileSetupPrompt(lines, context, foundation, catalog, pack);
  }

  return lines.join('\n');
}

function buildProfileSetupPrompt(
  lines: string[],
  context: ExtractionContext,
  foundation: string,
  catalog: string,
  pack: NonNullable<ExtractionContext['nichePack']>,
): void {
  const missing = context.missing_fields ?? [];

  lines.push(
    '## Current stage: PROFILE SETUP (Этап A)',
    'Help the user describe their business and fill in a product card.',
    '',
  );

  // ── CASE A: Foundation not yet complete (раздел 7.1.2 ТЗ v9.1) ──────────
  // The validator BLOCKS upsert_product_card until foundation has
  // company_description + market_type + geography. Focus on collecting these first.
  if (context.foundationComplete === false) {
    lines.push(
      '## BLOCKING CONDITION: BusinessFoundation not complete',
      'company_description, market_type, and geography are REQUIRED before any service card.',
      'Your ONLY allowed action is upsert_business_foundation.',
      'DO NOT output upsert_product_card — it will be rejected by the validator.',
      '',
      'Extract from the user message:',
      '  • company_description — what the business does (1-2 sentences, from user words)',
      '  • market_type         — "B2C" (serves individuals) | "B2B" (serves companies)',
      '                          Infer: "маникюр/стрижка/ремонт квартиры" → B2C;',
      '                          "поставляем/консультируем компании" → B2B.',
      '                          Do NOT ask "B2B or B2C" literally — always infer.',
      '  • geography           — array of cities/regions the user mentioned',
      '',
      '## NEVER use placeholders',
      'If the user did NOT provide a value, OMIT the field entirely — do NOT fill it with',
      '"<UNKNOWN>", "unknown", "не указано", "-", or any invented text.',
      'A missing field triggers a follow-up question. A fake field silently bypasses the gate.',
      'BAD:  { "geography": ["<UNKNOWN>"] }',
      'GOOD: omit geography from payload, set clarification_text asking for the city.',
      '',
      'If any of these are MISSING from the message, set clarification_text.',
      'Priority order for what to ask:',
      '  1. company_description — if not yet known',
      '  2. geography           — if not mentioned',
      '  (market_type: always infer, never ask directly)',
      '',
      '## STRICT MARKDOWN PROHIBITION for clarification_text',
      '  Plain text only. NO **bold**, NO *italic*, NO bullet lists, NO dashes as list markers.',
      '  BAD:  "**Понял!** Расскажите:\n- где вы работаете\n- кто ваши клиенты"',
      '  GOOD: "Понял, вы занимаетесь строительством. Подскажите, в каких городах работаете?"',
      '  Keep it 1-2 sentences MAX.',
      '',
      '## IMPORTANT',
      '  • Never include tenant_id in the payload — the system injects it automatically.',
      '',
      '---',
      `Tenant: ${context.tenant_id}`,
      '',
      'Business foundation:',
      foundation,
      '',
      `Product catalog (${context.productCatalog.length} items):`,
      catalog,
    );
    return;
  }

  // ── CASE B: Foundation complete — collect service card ────────────────────

  lines.push(
    '## CRITICAL RULE: Plain text ONLY — no markdown anywhere',
    'This applies to ALL output fields: clarification_text, next_step.question, everywhere.',
    'NO **bold**, NO *italic*, NO bullet lists with - or *, NO ## headers, NO backticks.',
    'BAD:  "**Понял!** Вот что нужно:\\n- Как называется услуга?\\n- Сколько стоит?"',
    'GOOD: "Понял. Скажите, как называется услуга и сколько она стоит?"',
    '',
  );

  if (context.activeServiceLine) {
    lines.push(
      `## Active service: "${context.activeServiceLine}"`,
      'You are currently filling THIS service card. Do NOT switch to a different service_line.',
      'If the user mentions something that sounds like a DIFFERENT new service:',
      '  → set proposed_actions: [] and clarification_text:',
      `    "Это уточнение к текущей услуге или вы хотите добавить отдельную новую услугу?"`,
      '',
    );
  }

  if (missing.length > 0) {
    lines.push(
      `## Already filled. Still missing from the best card: [${missing.join(', ')}]`,
      'Ask ONLY the NEXT missing field — do not re-ask what is already filled.',
      '',
    );
  }

  lines.push(
    '## Your task',
    'Analyse the user message and call extract_business_intent with:',
    '  • intent     — choose ONE:',
    '      "business_setup"  — user is describing/adding a service NOT yet in the product catalog',
    '      "product_update"  — user is enriching a service that ALREADY exists in the catalog below',
    '      "inquiry"         — user asks a question without setting up a service',
    '      "small_talk"      — greeting or off-topic',
    '  • confidence — 0–1',
    '  • proposed_actions — list of actions to execute (see rules below)',
    '  • next_step  — optional follow-up question ONLY to enrich an already-created card',
    '',
    '## Rule: create upsert_product_card immediately on first mention of a service',
    'Do NOT wait for a complete description. Do NOT replace the action with next_step.',
    'If the user mentions any service or product (even briefly), output upsert_product_card NOW.',
    '',
    '## Also output upsert_business_foundation when the user mentions company/market/geography data.',
    'Always include it BEFORE upsert_product_card in proposed_actions.',
    '',
    '### Required payload fields for upsert_product_card (all five are mandatory):',
    '  id            — snake_case latin slug, e.g. "manicure_classic", "laptop_repair"',
    '  name          — service name as the user stated it (in Russian if they used Russian)',
    '  category      — infer from context; e.g. "Красота и уход", "Ремонт техники",',
    '                  "Юридические услуги", "Строительство", "Общественное питание"',
    '  service_line  — same value as id',
    '  pricing_model — "fixed" | "from_price" | "per_m3" | "custom"',
    '                  When "custom", fill estimate_inputs[] with 2-3 parameters needed to quote price.',
    '',
    '### Optional payload fields — fill ONLY when user explicitly stated the value:',
    '  price, unit, currency,',
    '  includes[], excludes[], estimate_inputs[], customer_segments[], geography[],',
    '  scout_search_signals[], scout_sources[], avi_qualification_questions[], handoff_to_human_rules[]',
    '  (ALL list fields must be arrays of strings, e.g. ["Москва"] not "Москва")',
    '',
    '### Examples',
    '',
    'Example 1 — Beauty (short first message):',
    '  User: "Делаю маникюр, цена 1500 рублей"',
    '  → proposed_actions: [',
    '      { "type": "upsert_business_foundation", "payload": { "company_description": "Маникюр", "market_type": "B2C" } },',
    '      { "type": "upsert_product_card", "payload": { "id": "manicure_classic",',
    '          "name": "Классический маникюр", "category": "Красота и уход",',
    '          "service_line": "manicure_classic", "pricing_model": "fixed",',
    '          "price": 1500, "currency": "RUB" } }',
    '    ]',
    '',
    'Example 2 — Construction (rich first message):',
    '  User: "Строим ленточные фундаменты, 8000р/м3, работаем по России"',
    '  → proposed_actions: [',
    '      { "type": "upsert_business_foundation", "payload": { "company_description": "Строительство фундаментов",',
    '          "market_type": "B2C", "geography": ["Россия"] } },',
    '      { "type": "upsert_product_card", "payload": { "id": "strip_foundation",',
    '          "name": "Ленточный фундамент", "category": "Строительство",',
    '          "service_line": "strip_foundation", "pricing_model": "per_m3",',
    '          "price": 8000, "currency": "RUB", "unit": "m3", "geography": ["Россия"] } }',
    '    ]',
    '',
    '## When proposed_actions is empty',
    'If user is confused ("в смысле?", "подскажи", "не понимаю", or off-topic):',
    'set proposed_actions: [] and write clarification_text.',
    '',
    '## Vague-only answers — do NOT accept, always press for specifics',
    'If the user answers a field question with ONLY a vague phrase — do NOT write it into proposed_actions.',
    'Vague phrases: "по договоренности", "всё включено", "разное", "как обычно", "не знаю",',
    '  "по ситуации", "зависит", "обсудим", "стандартно", "все как у всех".',
    'Instead: set proposed_actions: [] and write clarification_text that:',
    '  1. Acknowledges the answer in one phrase.',
    '  2. Gives a concrete niche-specific EXAMPLE of what a real answer looks like (1-2 items).',
    '  3. Re-asks the same question.',
    'BAD:  User: "всё включено" → proposed_actions: [{...includes: ["всё включено"]}]',
    'GOOD: User: "всё включено" → proposed_actions: [] + clarification_text:',
    `  "Понял, что много включено. Перечислите конкретно — например: ${pack.nodes[missing[0] ?? 'includes']?.example ?? pack.nodes.includes.example}. Что именно входит?"`,
    '',
    '## Rules for clarification_text (reminder: plain text only, see CRITICAL RULE above)',
    '  2-3 sentences MAX. Conversational Russian. No markdown (already forbidden above).',
    `  Next missing field: "${missing[0] ?? 'service'}". Form one concrete follow-up question.`,
    `  "scout_signals" → ask: "${pack.nodes.scout_signals.question} Например: ${pack.nodes.scout_signals.example}."`,
    `  "в смысле?" → explain briefly what was asked, give one short example (like: ${pack.nodes[missing[0]] ? pack.nodes[missing[0]].example : 'конкретный вариант из их ниши'}), re-ask.`,
    `  "подскажи/помоги" → one concrete example from their service type, then re-ask.`,
    `  Confused/off-topic → one short acknowledgement, then ask the next missing field directly.`,
    '',
    '## IMPORTANT',
    '  • Never include tenant_id in the payload — the system injects it automatically.',
    '  • next_step is for enriching details AFTER the card exists, not instead of creating it.',
    '  • If unsure about category or pricing_model — make a reasonable inference; do not skip.',
    '',
    '---',
    `Tenant: ${context.tenant_id}`,
  );

  if (context.activeFactId) lines.push(`Active fact ID: ${context.activeFactId}`);

  lines.push(
    '',
    'Business foundation:',
    foundation,
    '',
    `Product catalog (${context.productCatalog.length} items):`,
    catalog,
  );
}

function buildDailyAssistantPrompt(
  lines: string[],
  context: ExtractionContext,
  foundation: string,
  catalog: string,
): void {
  lines.push(
    '## Current stage: DAILY ASSISTANT (Этап B)',
    'Profile setup is COMPLETE. Do NOT ask the user to describe their business or fill in a service card.',
    '',
    '## Your task in this mode',
    'Analyse the user message and call extract_business_intent with:',
    '  • intent     — one of "inquiry" | "product_update" | "business_setup" | "small_talk"',
    '  • confidence — 0–1',
    '  • proposed_actions — only if the user explicitly asks to add/change a service',
    '  • next_step  — leave empty unless updating a card',
    '',
    '## Behaviour rules',
    '  • If user asks about metrics, leads, revenue, activity → set proposed_actions: []',
    '    and set clarification_text: 1-2 sentences, acknowledge + ask how you can help.',
    '  • If user mentions a new service → create upsert_product_card as usual.',
    '  • If user is confused → answer in clarification_text: 1-2 sentences, plain text.',
    '  • If nothing fits → set clarification_text: "Слушаю — чем могу помочь?"',
    '  • NO markdown in clarification_text: no **bold**, no bullet lists, no dashes.',
    '',
    '## IMPORTANT',
    '  • Never include tenant_id in the payload.',
    '  • In this mode the fallback phrase "Расскажите о вашей услуге..." is FORBIDDEN.',
    '',
    '---',
    `Tenant: ${context.tenant_id}`,
    '',
    'Business foundation:',
    foundation,
    '',
    `Product catalog (${context.productCatalog.length} items):`,
    catalog,
  );
}
