// Case card agent — preparation material.
//
// 50% of surveyed debaters named "not enough material to prepare" as a top-2
// blocker, and the product shipped 15 bare motions with zero analysis.
//
// Economics: a card is generated ONCE per topic and stored in the DB. With a
// fixed catalogue that is a few cents in total, forever, for every user. This
// is the cheapest high-value feature in the product, which is exactly why it
// runs off a cached table instead of a per-session call.

import { z } from 'zod';
import { env } from '@talqyla/config';
import type { AiProvider } from './provider.js';
import { safeJsonParse } from './json.js';

export const CaseCardSchema = z.object({
  stakeholders: z.array(z.string()).min(2).max(6),
  clashes: z.array(z.string()).min(2).max(4),
  proArguments: z.array(z.string()).min(2).max(5),
  conArguments: z.array(z.string()).min(2).max(5),
  traps: z.array(z.string()).min(1).max(4),
});

export type CaseCardData = z.infer<typeof CaseCardSchema>;

export interface CaseCardOutput extends CaseCardData {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
  parsed: boolean;
}

/** Neutral placeholder so a failed generation never blocks a session. */
export const CASE_FALLBACK: CaseCardData = {
  stakeholders: ['Кого это касается напрямую', 'Кто платит за решение', 'Кто его исполняет'],
  clashes: ['В чём стороны реально расходятся', 'Работает ли предложенный механизм'],
  proArguments: ['Главная выгода предложения', 'Кто выигрывает больше всех'],
  conArguments: ['Главная издержка предложения', 'Почему проблема решается иначе'],
  traps: ['Спорить о теме вообще вместо конкретной формулировки'],
};

export function buildCasePrompt(): string {
  return [
    'Ты — тренер по дебатам. Собери кейс-карту к теме для школьника или студента.',
    '',
    'Кейс-карта — это СЫРЬЁ для подготовки, а не готовая речь. Ученик собирает позицию сам.',
    '',
    'Правила:',
    '1. Стейкхолдеры — конкретные группы, а не «общество». Пиши, что каждая теряет или получает.',
    '2. Clash — точка, где стороны реально расходятся, а не пересказ темы.',
    '3. Аргументы обеих сторон — по одной строке, с механизмом, без воды.',
    '4. Ловушки — типичные ошибки именно на этой теме.',
    '5. Никаких готовых формулировок для зачитывания вслух. Короткие тезисы.',
    '6. Русский язык, нейтральный тон, без оценки того, какая сторона права.',
    '',
    'Ответ дай СТРОГО в виде JSON:',
    '{"stakeholders": ["..."], "clashes": ["..."], "proArguments": ["..."], "conArguments": ["..."], "traps": ["..."]}',
  ].join('\n');
}

export async function runCaseCard(
  ai: AiProvider,
  input: { topicTitle: string; topicDescription: string },
): Promise<CaseCardOutput> {
  const result = await ai.llm.complete({
    model: env.LLM_MODEL_CASE,
    system: buildCasePrompt(),
    messages: [
      {
        role: 'user',
        content: `Тема: ${input.topicTitle}\nОписание: ${input.topicDescription}\n\nСобери кейс-карту.`,
      },
    ],
    jsonMode: true,
    maxTokens: 900,
    temperature: 0.4,
  });

  const parsed = CaseCardSchema.safeParse(safeJsonParse(result.text));

  return {
    ...(parsed.success ? parsed.data : CASE_FALLBACK),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
    model: result.model,
    parsed: parsed.success,
  };
}
