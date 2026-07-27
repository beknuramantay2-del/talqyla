// Summarizer agent — compresses early dialogue history to bound context cost.
//
// ECONOMICS WARNING: this agent costs an extra LLM call. At
// MAX_ROUND_EXCHANGES <= 4 the history it compresses (~600 tokens) is cheaper
// than the call that compresses it, so it is a NET LOSS and is disabled by
// default via SUMMARIZER_ENABLED. Turn it on only for long rounds.

import { env } from '@talqyla/config';
import type { AiProvider } from './provider.js';

const SUMMARIZE_THRESHOLD_TURNS = 4;
const KEEP_RECENT_TURNS = 2;

export interface HistoryTurn {
  role: string;
  text: string;
}

export interface CompressResult {
  history: HistoryTurn[];
  costUsd: number;
  used: boolean;
}

export async function compressHistory(ai: AiProvider, history: HistoryTurn[]): Promise<CompressResult> {
  if (!env.SUMMARIZER_ENABLED) return { history, costUsd: 0, used: false };
  if (history.length <= SUMMARIZE_THRESHOLD_TURNS) return { history, costUsd: 0, used: false };

  const toSummarize = history.slice(0, history.length - KEEP_RECENT_TURNS);
  const recent = history.slice(history.length - KEEP_RECENT_TURNS);

  const dialogue = toSummarize
    .map((m, i) => `${i + 1}. ${m.role === 'student' ? 'Ученик' : 'Оппонент'}: ${m.text}`)
    .join('\n');

  const result = await ai.llm.complete({
    model: env.LLM_MODEL_SUMMARIZER,
    system:
      'Ты сжимаешь историю дебатов. Сохрани: ключевые аргументы ученика (с короткими цитатами), его уступки, открытые вопросы оппонента, и кто в каком пункте победил. Урони всё лишнее. 3–5 предложений максимум. На русском.',
    messages: [{ role: 'user', content: dialogue }],
    maxTokens: 250,
    temperature: 0.1,
  });

  return {
    history: [{ role: 'opponent', text: `[Сводка предыдущих обменов]\n${result.text}` }, ...recent],
    costUsd: result.costUsd,
    used: true,
  };
}
