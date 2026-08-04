# Статус перехода на v2

Документ отвечает на один вопрос: что уже работает, а что ещё нельзя обещать.

## Сделано

| Слой | Что изменилось |
|---|---|
| Схема | `PracticeSession`, `SessionScore`, `CaseCard`, `UsageEvent`; рубрика выросла на `CASE_ANALYSIS` и `QUICK_THINKING` |
| Миграция | `20260804090000_practice_sessions_v2` |
| Судья | `agents/speech-judge.ts`: оценивает одну речь, отдаёт ровно один дрилл |
| Материал | `agents/casecard.ts`, карта кешируется на тему |
| Оппонент | понижен до POI, один короткий вызов, отключается `POI_ENABLED=false` |
| Деньги | `usage_events` подключён; STT и TTS впервые проходят суточный кап |
| API | `/sessions`, `/sessions/case`, `/sessions/:id/poi`, `/speech`, `/blitz`, `/abort`, `/dashboard/league` |
| Фронт | `/sessions/new` и `/sessions/[id]` (подготовка → речь → ballot), дашборд на сессиях |
| Юнит-тесты | `session.service.test.ts`, `speech-judge.test.ts` |
| Smoke | гоняет сессию: создание, чтение, список, дашборд, лига, валидация речи; с `SMOKE_WITH_LLM=1` ещё кейс-карту, ballot и защиту от двойной сдачи |
| Eval | `speech-golden-set.json` + `run-speech-eval.ts`: точность, стабильность и **попадание дрилла** |

## Разрывы, которые нельзя замалчивать

1. **Golden set речей в статусе `draft`.** Восемь кейсов, оценки проставлены
   разработчиком. Набор ловит дрейф промпта, но не доказывает правоту судьи.
   Обещать школе объективное судейство нельзя, пока тренер не подписал кейсы.
2. **Рубрика расширена, а не заменена.** `DELIVERY` и `LOGIC` остались в enum и
   приходят из истории v1. Фронт их отображает, судья больше не выставляет.
3. **APF не реализован.** В UI формат упоминается как справка. Поддержки шести
   речей и другого порядка в бэкенде нет.
4. **Родительское согласие** по-прежнему без юридического текста.
5. **Раунды v1 живы.** `/rounds` и их экраны работают на чтение истории.

## Порядок выката

```bash
pnpm db:generate      # обязательно: enum вырос, клиент без этого не соберётся
pnpm typecheck
pnpm test
pnpm -r run build
pnpm db:deploy        # migrate deploy, не migrate dev
pnpm smoke            # против запущенного API
```

`ALTER TYPE ... ADD VALUE` в миграции безопасен на Postgres 12+: значение
добавляется в транзакции, но не используется в ней же.

Ночной `judge-eval` теперь гейтит судью речей, а судья v1 остался отчётом с
`continue-on-error`.

## Что удалить, когда история перенесена

`round.service.ts`, `agents/judge.ts`, `agents/debater.ts`, `agents/summarizer.ts`,
`routes/rounds.ts`, `evals/lib.ts`, `evals/golden-set.json`,
`apps/web/src/app/rounds/**`, модели `DebateRound`, `DebateTurn`, `SkillScore`,
`RoundFeedback`.
