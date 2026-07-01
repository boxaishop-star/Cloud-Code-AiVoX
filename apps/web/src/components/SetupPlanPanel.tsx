'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';

type NodeStatus = 'done' | 'current' | 'upcoming' | 'skipped';

interface PlanItem {
  id: string;
  status: NodeStatus;
}

interface SectionSummary {
  id: string;
  label: string;
  status: NodeStatus;
  nodeIds: string[];
}

interface SetupPlanData {
  readiness_score: number;
  readyToLaunch: boolean;
  sections: SectionSummary[];
  plan: PlanItem[];
}

// ── Status icon ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: NodeStatus }) {
  if (status === 'done') {
    return (
      <span className="w-[18px] h-[18px] rounded-full bg-green-100 text-green-600 flex items-center justify-center text-[9px] font-bold shrink-0">
        ✓
      </span>
    );
  }
  if (status === 'current') {
    return (
      <span className="w-[18px] h-[18px] rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-[9px] font-bold shrink-0">
        ▶
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="w-[18px] h-[18px] rounded-full bg-[#F3F3F0] text-gray-300 flex items-center justify-center text-[10px] font-bold shrink-0">
        –
      </span>
    );
  }
  // upcoming
  return (
    <span className="w-[18px] h-[18px] rounded-full border-2 border-[#E5E5E3] shrink-0" />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SetupPlanPanel({ refreshKey }: { refreshKey?: number }) {
  const { user, isLoaded } = useUser();
  const tenantId = user?.publicMetadata?.tenant_id as string | undefined;

  const [data, setData] = useState<SetupPlanData | null>(null);
  const [fetching, setFetching] = useState(false);
  const [activating, setActivating] = useState(false);

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const fetchPlan = useCallback(async () => {
    if (!tenantId) return;
    setFetching(true);
    try {
      const res = await fetch(`/api/setup-plan?tenant_id=${encodeURIComponent(tenantId)}`);
      if (res.ok) {
        const json = await res.json() as SetupPlanData & { sections?: SectionSummary[] };
        if (json.sections) setData(json as SetupPlanData);
      }
    } catch {
      // network error — keep previous data
    } finally {
      setFetching(false);
    }
  }, [tenantId]);

  useEffect(() => { fetchPlan(); }, [fetchPlan, refreshKey]);

  // Auto-scroll to the first 'current' section after data updates
  useEffect(() => {
    if (!data) return;
    const current = data.sections.find((s) => s.status === 'current' && s.id !== 'launch');
    if (current) {
      sectionRefs.current[current.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [data]);

  const activate = useCallback(async () => {
    if (!tenantId || activating) return;
    setActivating(true);
    try {
      const res = await fetch('/api/activate-daily-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (res.ok) await fetchPlan();
    } catch {
      // ignore
    } finally {
      setActivating(false);
    }
  }, [tenantId, activating, fetchPlan]);

  // Not ready to show until Clerk is loaded and user has a tenant
  if (!isLoaded || !tenantId) return null;

  const mainSections = (data?.sections ?? []).filter((s) => s.id !== 'launch');
  const launchSection = data?.sections.find((s) => s.id === 'launch');
  const score = data?.readiness_score ?? 0;

  function sectionTooltip(s: SectionSummary): string {
    if (s.nodeIds.length === 0) return s.label;
    const nodes = s.nodeIds.map((id) => data?.plan.find((n) => n.id === id)).filter(Boolean) as PlanItem[];
    const applicable = nodes.filter((n) => n.status !== 'skipped');
    const done = applicable.filter((n) => n.status === 'done').length;
    return `${s.label}: ${done} из ${applicable.length} заполнено`;
  }

  function SectionRow({ s }: { s: SectionSummary }) {
    const isCurrent = s.status === 'current';
    const isSkipped = s.status === 'skipped';
    const isDone = s.status === 'done';

    return (
      <div
        ref={(el) => { sectionRefs.current[s.id] = el; }}
        title={sectionTooltip(s)}
        className={[
          'flex items-center gap-2.5 px-3 py-[7px] rounded-xl text-[13px] cursor-default transition-colors',
          isCurrent ? 'bg-amber-50 border border-amber-200' : 'hover:bg-black/[0.025]',
        ].join(' ')}
      >
        <StatusDot status={s.status} />
        <span
          className={[
            'flex-1 leading-tight',
            isDone ? 'text-[#374151] font-medium' : '',
            isCurrent ? 'text-amber-700 font-semibold' : '',
            isSkipped ? 'text-gray-300 line-through' : '',
            s.status === 'upcoming' ? 'text-gray-400' : '',
          ].join(' ')}
        >
          {s.label}
        </span>
      </div>
    );
  }

  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-[#E5E5E3] bg-white overflow-hidden">

      {/* Progress header */}
      <div className="px-4 pt-4 pb-3 border-b border-[#F0F0EE] shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#A3A3A3]">
            Прогресс
          </h2>
          {fetching && (
            <span className="text-[11px] text-[#C4C4C0]">обновление…</span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex-1 h-[6px] bg-[#F0F0EE] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#6366F1] rounded-full transition-all duration-500"
              style={{ width: `${score}%` }}
            />
          </div>
          <span className="text-[13px] font-semibold text-[#374151] w-9 text-right tabular-nums">
            {score}%
          </span>
        </div>
      </div>

      {/* Sections list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
        {data ? (
          mainSections.map((s) => <SectionRow key={s.id} s={s} />)
        ) : (
          // Skeleton while loading
          Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-[7px]">
              <span className="w-[18px] h-[18px] rounded-full bg-[#F0F0EE] shrink-0 animate-pulse" />
              <span className="h-3 bg-[#F0F0EE] rounded flex-1 animate-pulse" />
            </div>
          ))
        )}
      </div>

      {/* Launch block */}
      {launchSection && (
        <div className="shrink-0 px-3 py-3 border-t border-[#F0F0EE]">
          {launchSection.status === 'done' ? (
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="w-[18px] h-[18px] rounded-full bg-green-100 text-green-600 flex items-center justify-center text-[9px] font-bold shrink-0">
                ✓
              </span>
              <span className="text-[13px] text-green-700 font-semibold">Daily Assistant активен</span>
            </div>
          ) : (
            <>
              <button
                onClick={activate}
                disabled={launchSection.status !== 'current' || activating}
                className="w-full py-2.5 px-4 rounded-xl text-[13px] font-semibold transition-all bg-[#6366F1] text-white hover:bg-[#4F46E5] active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {activating ? 'Запуск…' : 'Запустить Daily Assistant'}
              </button>
              {launchSection.status === 'upcoming' && (
                <p className="mt-1.5 text-[11px] text-[#A3A3A3] text-center">
                  Заполните профиль для запуска
                </p>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
