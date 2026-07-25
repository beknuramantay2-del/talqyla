# ДебатоТренер

AI-тренер по дебатам для школьников 7–11 классов. Структурированные раунды с **голосовым спарринг-оппонентом** и **агентом-судьёй**, который выставляет числовую оценку по 5 навыкам и даёт конкретный фидбек с цитатами.

**Ключевое отличие от чат-врапперов:** не свободный чат, а методология в действии — ученик строит аргумент по схеме `Claim → Warrant → Impact`, потом ведёт живой голосовой диалог с оппонентом, а отдельный агент-судья разбирает весь раунд по рубрике.

## Стек

- **Монорепо:** pnpm workspace (Node ≥ 20)
- **БД:** PostgreSQL 16 + Prisma 5 (cuid id, snake_case `@map`)
- **Кеш/rate-limit:** Redis 7
- **API:** Fastify 4 (Zod type-provider, JWT + refresh-token family, Swagger)
- **Веб:** Next.js 14 (App Router) + Tailwind + React Query + Zustand
- **AI:** OpenRouter (Claude Haiku — оппонент/суммаризатор, Sonnet — судья) + STT (Groq Whisper) + TTS (OpenAI)

Все AI-сервисы имеют **режим `stub`** — весь UI и флоу раунда можно разрабатывать и тестировать без единого платного ключа.

## Структура

```
debatotrainer/
├─ apps/
│  ├─ api/    Fastify: auth, agents, voice, round-orchestration, dashboard
│  └─ web/    Next.js: 4 экрана + входной тест
├─ packages/
│  ├─ config/ Zod env-схема + доменные примитивы
│  └─ db/     Prisma schema дебатов + seed + client singleton
└─ docs/
   └─ plans/  дизайн-документы
```

## Быстрый старт

```bash
# 1. Зависимости и окружение
pnpm install
cp .env.example .env          # всё работает со значениями по умолчанию (stub-режим)

# 2. Поднять Postgres + Redis
pnpm infra:up

# 3. Миграция и сиды (15 тем + демо-пользователи)
pnpm db:migrate
pnpm db:seed

# 4. Запустить API + web параллельно
pnpm dev
#   → API:  http://localhost:4000  (Swagger на /docs)
#   → Web:  http://localhost:3000
```

Демо-доступы (печатаются в консоли после `pnpm db:seed`):
- ученик: `ivan@example.com` / `debato1234`
- админ: `admin@example.com` / `debato1234`

## Подключение AI

Когда UI готов и хочется «настоящий» продукт, заполни три ключа в `.env`:

| Переменная | Где взять | Сколько положить |
|---|---|---|
| `OPENROUTER_API_KEY` | openrouter.ai → Keys | $20 |
| `GROQ_API_KEY` | console.groq.com → API Keys | $0 (бесплатный тир) |
| `OPENAI_API_KEY` | platform.openai.com → Billing | $5 |

Затем переключи `STT_PROVIDER=groq` и `TTS_PROVIDER=openai`. Один раунд стоит ~$0.08.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` | API + web параллельно |
| `pnpm dev:api` / `pnpm dev:web` | по отдельности |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio` | миграции, сиды, Prisma Studio |
| `pnpm infra:up` / `pnpm infra:down` / `pnpm infra:logs` | Docker stack |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | проверки |

## Что НЕ в этом MVP (YAGNI)

- Kubernetes / Terraform / CI (Docker Compose достаточно)
- ElevenLabs (hook заложен, OpenAI TTS достаточно на старте)
- Real-time WebSocket (раунд = последовательные REST-вызоды; живость диалога — за счёт авто-TTS)
- Админ-панель (данные через Prisma Studio)
- Платёжки (бесплатная бета для 10 школьников)

## Документация

- Дизайн-документ MVP: [`docs/plans/2026-07-13-debatotrainer-mvp-design.md`](docs/plans/2026-07-13-debatotrainer-mvp-design.md)
- Промпты агентов: [`docs/prompts.md`](docs/prompts.md)
