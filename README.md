# AiVoX — монорепо

Монорепо с тремя основными частями:

| Часть | Расположение | Порт |
|---|---|---|
| Core library | `packages/core` | — |
| API (Express + Clerk) | `apps/api` | 3000 |
| Web (Next.js + Clerk) | `apps/web` | 3001 |

---

## Требования

- Node.js 20+
- PostgreSQL (локально или через Docker)
- Аккаунт [Clerk](https://clerk.com) (бесплатный план достаточен)
- API-ключ Anthropic (`ANTHROPIC_API_KEY`)

---

## Первый запуск

### 1. Зависимости

```bash
npm install
```

### 2. Переменные окружения

Скопируй `.env.example` (если есть) или создай `.env` в корне монорепо:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/aivox_dev
ANTHROPIC_API_KEY=sk-ant-...
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
```

Для `apps/web` создай `apps/web/.env.local` по образцу `apps/web/.env.local.example`:

```bash
cp apps/web/.env.local.example apps/web/.env.local
# Заполни значениями из Clerk Dashboard
```

### 3. База данных

Примени Prisma-миграции:

```bash
npx prisma migrate deploy --schema packages/core/prisma/schema.prisma
```

Или в режиме разработки:

```bash
npx prisma migrate dev --schema packages/core/prisma/schema.prisma
```

---

## Локальная разработка

Запускай каждую часть в отдельном терминале.

### Postgres (Docker, опционально)

```bash
docker run -d \
  --name aivox-pg \
  -e POSTGRES_USER=aivox \
  -e POSTGRES_PASSWORD=aivox \
  -e POSTGRES_DB=aivox_dev \
  -p 5432:5432 \
  postgres:16
```

### apps/api

```bash
npm run dev --workspace=apps/api
# → http://localhost:3000
```

### apps/web

```bash
npm run dev --workspace=apps/web
# → http://localhost:3001
```

Открой [http://localhost:3001](http://localhost:3001) — редирект на `/sign-in`, после входа попадаешь на `/setup` (чат Business Assistant).

---

## Тесты

```bash
# Все тесты монорепо
npm test

# Только core
npm test --workspace=packages/core

# Только api
npm test --workspace=apps/api
```

---

## Утилиты разработки

Seed демо-тенанта `scout_avi_demo` (бьюти-студия):

```bash
npx tsx scripts/dev/seed-demo-tenant.ts
```

Ручная проверка цикла Scout → Avi:

```bash
npx tsx scripts/dev/scout-avi-cycle.ts
```
