# @aivox/core — Domain Core (Этап 0, ТЗ v3.0)

Это не демо и не прототип "для презентации" — это рабочий старт кодовой базы,
покрытый тестами, которые прямо требует раздел 23 ТЗ. Дальше команда продолжает
этот код через **Claude Code** (или вручную), а не переписывает с нуля.

## Что здесь реально работает

- Схемы `BusinessFoundation`, `ProductCard`, `RelationshipCard`, `ToolAction` (zod) —
  раздел 10–12, 17 ТЗ. В `RelationshipCard` обязательны `legal_basis` и `source_tier`
  (раздел 7.3.2, 19 ТЗ) — без них запись не пройдёт валидацию схемы.
- `IntentEngine` — простая rule-based классификация для `small_talk`/`explain_product`/`reset`
  (раздел 14, 15.2 ТЗ — эти интенты не должны идти в LLM).
- `ValidationLayer` — реальные проверки: категория не может быть услугой, дубли по
  `service_line`, запрет перезаписи точной цены нулём, проверка `segment`/`buyer_type`
  (раздел 7.1, 8.1, 16, 19 ТЗ), правило Tier 2 → `pending_review` (раздел 7.3.1 ТЗ).
- `ToolLayer` (`InMemoryStore`) — применение действий с изоляцией по `tenant_id`
  (раздел 9 ТЗ). На Этапе 1 заменяется на слой доступа к Postgres с тем же интерфейсом.
- `NextStepController` — таблица приоритетов из раздела 18 ТЗ + расчёт `readiness_score`
  по правилу раздела 22.4 ("100 ⇔ missing_fields пуст").
- `Orchestrator.process()` — реализация контракта `processBusinessAssistantMessage`
  (раздел 13 ТЗ), независимая от UI и от конкретного провайдера LLM.
- **Golden test** на "ленточный фундамент" (раздел 20.1, 22.1 ТЗ) — зелёный.
- **Forbidden responses test** — гарантирует архитектурную невозможность `[object Object]`.
- **Tenant isolation test** — раздел 9, 23 ТЗ: блокирующий тест, провал = стоп релиз.

## Самое важное: как сюда подключается реальная LLM (Этап 1)

`src/extraction/types.ts` определяет интерфейс `ExtractionProvider`. Сейчас Orchestrator
получает `MockExtractionProvider` с зафиксированными фикстурами (детерминизм для CI).

Команда пишет `ClaudeExtractionProvider implements ExtractionProvider`, который:
1. Вызывает Anthropic API с **tool use** (structured output), а не парсит свободный текст —
   это устраняет весь класс багов "JSON repair", описанный в v1 ТЗ (раздел 16 ТЗ v3.0).
2. Возвращает `ExtractionResult` той же формы, что и мок.
3. Подставляется в `new BusinessAssistantOrchestrator(store, claudeProvider)` —
   **ни одна строка в `orchestrator.ts` не меняется.**

Golden test на этом этапе дублируется: текущий (с моком) остаётся в CI как regression test
архитектуры; добавляется отдельный **integration test** с реальным вызовом API (вне
обязательного CI на каждый PR — слишком медленно/дорого/недетерминированно для gate,
запускается отдельным workflow по cron или перед релизом).

## Чего здесь осознанно нет (и почему)

- **Postgres** — Этап 0 по ТЗ тестируется в изоляции, без БД. `InMemoryStore` — это
  тот же интерфейс (`getProductCards`, `applyAction`...), который на Этапе 1 реализуется
  поверх Prisma/Drizzle + Postgres с автоматическим фильтром по `tenant_id`.
- **Source Connectors для Scout (Tier 1/2)** — раздел 7.3.5 ТЗ относит их к Этапу 0-2,
  но это сетевые интеграции с внешними API, которые нет смысла писать до того, как
  команда подтвердит конкретные API-ключи/договоры (2ГИС Business API и т.п.).
  `create_scout_job` в `ToolAction` уже типизирован — коннектор подключается туда же.
- **Auth, API Gateway, rate limiting** — раздел 8, 19, 22 ТЗ, инфраструктурный слой
  Этапа 1, не Domain Core.

## Запуск

```bash
npm install
npx tsc -p tsconfig.json --noEmit   # строгая проверка типов
npx vitest run                       # все тесты, включая golden test
```

## Дальше — что делает команда

1. Подключить этот каталог как пакет в монорепозитории (`packages/core`), когда
   появятся `apps/api`, `apps/admin-ui`, `apps/avi-widget` (Этап 1-2 ТЗ).
2. CI (`.github/workflows/ci.yml`) — сделать **required check** в настройках GitHub:
   PR не мержится в `main`, если `tsc` или `vitest` красные. Это физическая реализация
   "ворот этапов" из раздела 25 ТЗ, а не договорённость на словах.
3. Писать `ClaudeExtractionProvider` (см. выше) — следующая по приоритету задача,
   она открывает реальный Setup-чат (Этап 1).
