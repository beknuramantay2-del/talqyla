# Статус перехода на v2

Документ отвечает на один вопрос: что уже работает, а что ещё нельзя обещать.

## Сделано

| Слой | Что изменилось |
|---|---|
| Схема | `PracticeSession`, `SessionScore`, `CaseCard`, `UsageEvent`; рубрика выросла на `CASE_ANALYSIS` и `QUICK_THINKING` |
| Миграция | `20260804090000_practice_sessions_v2` |
| Судья | новый `agents/speech-judge.ts`: оценивает одну речь, отдаёт ровно один дрилл |
| Материал | `agents/casecard.ts`, карта кешируется на тему |
| Оппонент | понижен до POI, один короткий вызов, отключается `POI_ENABLED=false` |
| Деньги | `usage_events` подключён; STT и TTS впервые проходят суточный кап |
| API | `/sessions`, `/sessions/case`, `/sessions/:id/poi`, `/speech`, `/blitz`, `/abort`, `/dashboard/league` |
| Фронт | `/sessions/new` и `/sessions/[id]` (подготовка → речь → ballot), дашборд на сессиях |
| Тесты | `session.service.test.ts`, `speech-judge.test.ts` |

## Разрывы, которые нельзя замалчивать

1. **Golden set измеряет судью v1.** `evals/` держит рубрику из пяти старых
   навыков и проверяет `agents/judge.ts`. К `speech-judge.ts` он не применим.
   Пока не собран новый набор, точность судьи v2 не измерена ничем.
2. **Smoke гоняет флоу раундов.** `scripts/smoke.mjs` проходит регистрацию,
   темы и раунд v1. Сессии в нём не покрыты, добавить до пилота.
3. **Рубрика расширена, а не заменена.** `DELIVERY` и `LOGIC` остались в enum и
   могут прийти из истории v1. Фронт их отображает, судья больше не выставляет.
4. **APF не реализован.** В UI формат упоминается как справка. Поддержки шести
   речей и другого порядка в бэкенде нет.
5. **Родительское согласие** по-прежнему без юридического текста.

## Порядок выката

```bash
pnpm db:generate      # обязательно: enum вырос, клиент без этого не соберётся
pnpm typecheck
pnpm test
pnpm -r run build
pnpm db:deploy        # migrate deploy, не migrate dev
```

`ALTER TYPE ... ADD VALUE` в миграции безопасен на Postgres 12+: значение
добавляется в транзакции, но не используется в ней же.

## Что удалить, когда история перенесена

`round.service.ts`, `agents/judge.ts`, `agents/debater.ts`, `agents/summarizer.ts`,
`routes/rounds.ts`, `apps/web/src/app/rounds/**`, модели `DebateRound`,
`DebateTurn`, `SkillScore`, `RoundFeedback`.
