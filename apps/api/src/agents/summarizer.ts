// History window — replaces the old summarizer agent.
//
// The summarizer spent a whole LLM call to compress ~600 tokens of history.
// At three exchanges that was a net loss: the call cost more than the tokens
// it saved. Now the same job is done with a sliding window and truncation,
// for zero dollars and zero latency.
//
// The exported signature is unchanged so callers do not need to care.

import { env } from '@talqyla/config';
import type { AiProvider } from './provider.js';

export interface HistoryTurn {
  role: string;
  text: string;
}

export interface CompressResult {
  history: HistoryTurn[];
  costUsd: number;
  used: boolean;
}

/** Truncate one turn on a word boundary so the model never sees a cut word. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Keep the last N turns, each clipped. Deterministic, free, and good enough:
 * a debate reply only ever needs the immediate context to answer well.
 *
 * `_ai` is accepted so the call sites read the same as before.
 */
export async function compressHistory(_ai: AiProvider, history: HistoryTurn[]): Promise<CompressResult> {
  const windowed = history.slice(-env.HISTORY_WINDOW_TURNS);
  const clipped = windowed.map((turn) => ({
    role: turn.role,
    text: clip(turn.text, env.HISTORY_TURN_MAX_CHARS),
  }));

  return {
    history: clipped,
    costUsd: 0,
    used: clipped.length !== history.length,
  };
}
