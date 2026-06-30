'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

type AssistantMessage = {
  role: 'assistant';
  content: string;
  nextStep?: string;
};

type UserMessage = {
  role: 'user';
  content: string;
};

type Message = UserMessage | AssistantMessage;

const WELCOME: AssistantMessage = {
  role: 'assistant',
  content:
    'Привет! Я Business Assistant — помогу оформить бизнес-профиль для вашей компании. Расскажите о своём бизнесе: чем занимаетесь, какие услуги предлагаете, кто ваши клиенты и где вы работаете?',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function AssistantAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-[#6366F1] flex items-center justify-center shrink-0 text-white text-[11px] font-bold select-none">
      BA
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3.5 shadow-sm border border-[#F0F0EE] inline-flex">
        <div className="flex gap-[5px] items-center h-[18px]">
          <span className="thinking-dot w-[6px] h-[6px] rounded-full bg-[#6366F1] inline-block" />
          <span className="thinking-dot w-[6px] h-[6px] rounded-full bg-[#6366F1] inline-block" />
          <span className="thinking-dot w-[6px] h-[6px] rounded-full bg-[#6366F1] inline-block" />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role !== 'assistant') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] sm:max-w-[70%] bg-[#18181B] text-white rounded-2xl rounded-br-sm px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="max-w-[78%] sm:max-w-[70%] flex flex-col gap-2.5">
        <div className="bg-white text-[#374151] rounded-2xl rounded-bl-sm px-4 py-3 text-[15px] leading-relaxed shadow-sm border border-[#F0F0EE] whitespace-pre-wrap break-words">
          {msg.content}
        </div>
        {msg.nextStep && (
          <div className="bg-[#FFFBEB] border border-[#FDE68A] border-l-[3px] border-l-[#F59E0B] rounded-xl rounded-tl-none px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-[#B45309] mb-1.5">
              Следующий вопрос
            </p>
            <p className="text-[14px] text-[#92400E] leading-relaxed font-medium">
              {msg.nextStep}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SetupChat() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage: text }),
      });

      const data = (await res.json()) as {
        assistantResponse?: string;
        nextStep?: { id: string; question: string } | string;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? 'Что-то пошло не так. Попробуйте ещё раз.');
        return;
      }

      // nextStep приходит как объект { id, question } из OrchestratorResult — берём только question.
      const nextStepText = typeof data.nextStep === 'string'
        ? data.nextStep
        : data.nextStep?.question;

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.assistantResponse ?? '',
          nextStep: nextStepText,
        },
      ]);
    } catch {
      setError('Не удалось связаться с сервером. Проверьте подключение.');
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const canSend = input.trim().length > 0 && !loading;

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-7 flex flex-col gap-5">
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
          {loading && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="max-w-2xl mx-auto w-full px-4 sm:px-6 pb-2">
          <div className="flex items-start gap-2 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
            <span className="mt-px">⚠</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 bg-white border-t border-[#E5E5E3] px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize(e.target);
            }}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Расскажите о вашем бизнесе… (Enter — отправить, Shift+Enter — новая строка)"
            className="flex-1 resize-none bg-[#F8F7F4] border border-[#E5E5E3] rounded-xl px-4 py-3 text-[15px] text-[#18181B] placeholder-[#A3A3A3] focus:outline-none focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 transition-all leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Отправить"
            className="shrink-0 w-[42px] h-[42px] rounded-xl bg-[#6366F1] text-white flex items-center justify-center hover:bg-[#4F46E5] active:scale-95 transition-all disabled:opacity-35 disabled:cursor-not-allowed disabled:active:scale-100 mb-px"
          >
            <SendIcon />
          </button>
        </div>
        <p className="max-w-2xl mx-auto mt-2 text-[11px] text-[#C4C4C0] text-center select-none">
          Business Assistant не сохраняет и не передаёт данные третьим лицам.
        </p>
      </div>
    </div>
  );
}
