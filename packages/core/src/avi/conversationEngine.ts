import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ProductCard } from '../schemas/productCard.js';
import type { BusinessFoundation } from '../schemas/businessFoundation.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface AviLoggedFact {
  field: string;
  value: string;
  productCardVersion: string;
}

export interface AviClientFact {
  field: string;
  value: string;
}

export interface AviResponse {
  message: string;
  handoffTriggered: boolean;
  handoffReason?: string;
  loggedFacts: AviLoggedFact[];
  clientFacts: AviClientFact[];
  funnelSignal?: 'qualified' | 'proposal_needed' | 'won' | 'lost';
}

export interface AviConversationEngine {
  respond(
    incomingMessage: string,
    conversationHistory: { role: 'client' | 'avi'; text: string }[],
    productCard: ProductCard,
    foundation: BusinessFoundation,
  ): Promise<AviResponse>;
}

// ── Tool definition ───────────────────────────────────────────────────────────

const TOOL_NAME = 'avi_respond';

const AVI_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Generate a structured response to a client inbound message as Avi.',
  input_schema: {
    type: 'object' as const,
    required: ['message', 'handoff_triggered', 'logged_facts'],
    properties: {
      message: {
        type: 'string',
        description:
          'Response to the client in Russian. ' +
          'If handoff_triggered=true, write ONLY the neutral forwarding text — no facts, no price.',
      },
      handoff_triggered: {
        type: 'boolean',
        description:
          'true if the client message semantically matches any handoff_to_human_rule. ' +
          'Semantic match — not exact string equality.',
      },
      handoff_reason: {
        type: 'string',
        description: 'Short reason for handoff (e.g. which rule matched). Required when handoff_triggered=true.',
      },
      logged_facts: {
        type: 'array',
        description:
          'Every specific fact from the product card that is explicitly mentioned in the response. ' +
          'Empty array when handoff_triggered=true.',
        items: {
          type: 'object' as const,
          required: ['field', 'value'],
          properties: {
            field: {
              type: 'string',
              enum: [
                'price',
                'includes',
                'excludes',
                'estimate_inputs',
                'geography',
                'customer_segments',
                'avi_qualification_questions',
              ],
              description: 'Product card field name.',
            },
            value: {
              type: 'string',
              description: 'Exact value as it appears in the product card data.',
            },
          },
        },
      },
      client_facts: {
        type: 'array',
        description:
          'Facts the CLIENT stated about THEMSELVES (not the service). ' +
          'Capture only what they volunteered — never ask.',
        items: {
          type: 'object' as const,
          required: ['field', 'value'],
          properties: {
            field: {
              type: 'string',
              enum: ['name', 'contact', 'birthday', 'detected_need'],
            },
            value: { type: 'string' },
          },
        },
      },
      funnel_signal: {
        type: 'string',
        enum: ['qualified', 'proposal_needed', 'won', 'lost'],
        description:
          'ONLY set when the client gives an EXPLICIT, unambiguous signal — e.g. ' +
          '"хочу оформить заявку" → qualified/proposal_needed; "не интересно, спасибо" → lost; ' +
          '"согласен, когда начнёте" → won. Omit entirely if ambiguous — do NOT guess or score.',
      },
    },
  },
};

// ── Prompt builder (exported for testability) ─────────────────────────────────

export function buildAviSystemPrompt(card: ProductCard, foundation: BusinessFoundation): string {
  const rawDesc = foundation.company_description ?? '';
  const businessName = foundation.company_name
    || rawDesc.split(/[,.\-–—]/)[0].trim()
    || 'наш бизнес';

  const lines: string[] = [
    `Ты — Avi, AI-ассистент, отвечающий на входящие сообщения клиентов от имени «${businessName}».`,
    '',
    '## Строгие правила',
    '  • Язык: только русский.',
    '  • ТОЛЬКО ФАКТЫ: каждая конкретная деталь в ответе (цена, состав, условия, география,',
    '    адрес, телефон, режим работы) ОБЯЗАНА браться из разделов «Данные о бизнесе» или',
    '    «Карточка услуги» ниже. Не добавляй ничего сверх предоставленных данных.',
    '  • NO INVENTED AVAILABILITY: не утверждай наличие свободного времени, слотов,',
    '    «сегодня», «завтра», «прямо сейчас» — если этого нет в карточке.',
    '  • Если вопрос клиента выходит за рамки данных карточки — напиши «Уточню этот вопрос у специалиста».',
    '    При этом handoff_triggered = false. Не придумывай ответ.',
    '  • Не раскрывай, что ты AI.',
    '  • Тон: доброжелательный, деловой, краткий (1–3 предложения).',
    '',
    '## ПРАВИЛА ПЕРЕДАЧИ ДИАЛОГА',
    '',
    '### Универсальное правило (абсолютный приоритет, действует для всех ниш)',
    '  Если клиент просит позвонить, перезвонить, встретиться лично, поговорить',
    '  с человеком/мастером/менеджером или иным способом запрашивает прямой контакт —',
    '  handoff_triggered = true. Это правило НЕ требует совпадения с нишевыми правилами.',
    '',
    '### Нишевые правила (semantic match)',
    '  handoff_triggered = true также когда вопрос клиента по СМЫСЛУ совпадает с одним из',
    '  нишевых правил ниже. Вопрос вне карточки без совпадения с правилами —',
    '  НЕ является поводом для handoff_triggered = true.',
    '',
    '### При срабатывании любого правила',
    '  1. handoff_triggered = true.',
    '  2. message = ТОЛЬКО: «Передаю ваш вопрос — совсем скоро ответят».',
    '  3. НЕ упоминай цену, состав, условия в этом message.',
    '  4. logged_facts = [].',
  ];

  if (card.handoff_to_human_rules.length) {
    lines.push('', '#### Нишевые правила этой карточки');
    card.handoff_to_human_rules.forEach((r) => lines.push(`  • ${r}`));
  }

  lines.push(
    '',
    '## Регистрация фактов о клиенте (client_facts)',
    '  Если клиент называет своё имя, контакт (телефон/email), дату рождения или свою потребность —',
    '  фиксируй в client_facts[]. НЕ спрашивай эти данные — только записывай, если клиент упомянул сам.',
    '  Поля: name, contact, birthday, detected_need.',
    '',
    '## Сигнал воронки (funnel_signal) — только явные, однозначные слова клиента',
    '  "хочу оформить заявку" / "пришлите КП" → proposal_needed.',
    '  "согласен", "когда начнёте", "беру", "оплатил" → won.',
    '  "не интересно", "передумал", "нашёл другого" → lost.',
    '  ЗАПРЕЩЕНО угадывать намерение или оценивать вероятность — только прямые слова клиента.',
    '  Если сигнал неоднозначен — НЕ ставь funnel_signal вообще (раздел 4 ТЗ v9.1).',
  );

  const hasBusinessDetails = foundation.address || foundation.phone || foundation.working_hours;
  if (hasBusinessDetails) {
    lines.push('', '## Данные о бизнесе (МОЖНО использовать в ответах — только эти данные, не выдумывать)');
    if (foundation.address)       lines.push(`Адрес: ${foundation.address}`);
    if (foundation.phone)         lines.push(`Телефон: ${foundation.phone}`);
    if (foundation.working_hours) lines.push(`Режим работы: ${foundation.working_hours}`);
  }

  lines.push('', '## Карточка услуги (только эти данные можно использовать в ответе)');
  lines.push(`Услуга: ${card.name}`);
  lines.push(`Категория: ${card.category}`);

  if (card.price != null) {
    const suffix = card.unit ? ` / ${card.unit}` : '';
    lines.push(`Цена: ${card.price} ${card.currency}${suffix}`);
  } else if (card.pricing_model === 'custom') {
    lines.push('Цена: рассчитывается индивидуально');
  }

  if (card.includes.length) lines.push(`Включено: ${card.includes.join(', ')}`);
  if (card.excludes.length) lines.push(`Не включено: ${card.excludes.join(', ')}`);
  if (card.estimate_inputs.length) lines.push(`Для расчёта нужно: ${card.estimate_inputs.join(', ')}`);
  if (card.geography.length) lines.push(`География: ${card.geography.join(', ')}`);
  if (card.customer_segments.length) lines.push(`Клиенты: ${card.customer_segments.join(', ')}`);
  if (card.avi_qualification_questions.length) {
    lines.push(`Уточняющие вопросы для записи: ${card.avi_qualification_questions.join('; ')}`);
  }

  return lines.join('\n');
}

// ── Claude (Haiku) implementation ─────────────────────────────────────────────

export class ClaudeAviConversationEngine implements AviConversationEngine {
  private client: Anthropic;
  private readonly model = 'claude-haiku-4-5-20251001';

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required');
    this.client = new Anthropic({ apiKey });
  }

  async respond(
    incomingMessage: string,
    conversationHistory: { role: 'client' | 'avi'; text: string }[],
    productCard: ProductCard,
    foundation: BusinessFoundation,
  ): Promise<AviResponse> {
    const cardVersion = productCard.updated_at ?? productCard.id;

    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory.map((h): Anthropic.MessageParam => ({
        role: h.role === 'client' ? 'user' : 'assistant',
        content: h.text,
      })),
      { role: 'user', content: incomingMessage },
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      tools: [AVI_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      system: buildAviSystemPrompt(productCard, foundation),
      messages,
    });

    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block) throw new Error('Expected tool_use block in Avi Haiku response');
    const input = (block as { input: Record<string, unknown> }).input;

    const rawFacts = (input.logged_facts as Array<{ field: string; value: string }> | undefined) ?? [];
    const rawClientFacts = (input.client_facts as Array<{ field: string; value: string }> | undefined) ?? [];
    const rawFunnelSignal = input.funnel_signal as string | undefined;

    return {
      message: String(input.message),
      handoffTriggered: Boolean(input.handoff_triggered),
      handoffReason: input.handoff_reason ? String(input.handoff_reason) : undefined,
      loggedFacts: rawFacts.map((f) => ({
        field: String(f.field),
        value: String(f.value),
        productCardVersion: cardVersion,
      })),
      clientFacts: rawClientFacts.map((f) => ({ field: String(f.field), value: String(f.value) })),
      funnelSignal: rawFunnelSignal as AviResponse['funnelSignal'],
    };
  }
}

// ── Mock implementation (for deterministic tests) ─────────────────────────────

export class MockAviConversationEngine implements AviConversationEngine {
  constructor(
    private readonly fixtures: Record<
      string,
      {
        message: string;
        handoffTriggered?: boolean;
        handoffReason?: string;
        loggedFacts?: Array<{ field: string; value: string }>;
        clientFacts?: Array<{ field: string; value: string }>;
        funnelSignal?: AviResponse['funnelSignal'];
      }
    >,
  ) {}

  async respond(
    incomingMessage: string,
    _history: { role: 'client' | 'avi'; text: string }[],
    productCard: ProductCard,
    _foundation: BusinessFoundation,
  ): Promise<AviResponse> {
    const cardVersion = productCard.updated_at ?? productCard.id;
    const key = Object.keys(this.fixtures).find((k) => incomingMessage.includes(k));
    if (!key) {
      return { message: 'Уточню этот вопрос у специалиста.', handoffTriggered: false, loggedFacts: [], clientFacts: [] };
    }
    const fix = this.fixtures[key];
    return {
      message: fix.message,
      handoffTriggered: fix.handoffTriggered ?? false,
      handoffReason: fix.handoffReason,
      loggedFacts: (fix.loggedFacts ?? []).map((f) => ({ ...f, productCardVersion: cardVersion })),
      clientFacts: fix.clientFacts ?? [],
      funnelSignal: fix.funnelSignal,
    };
  }
}
