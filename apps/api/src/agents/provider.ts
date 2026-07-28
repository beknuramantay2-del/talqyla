// AI provider abstraction — single entry point for all LLM/STT/TTS calls.
//
// Every provider is selected via env vars (STT_PROVIDER, TTS_PROVIDER).
// All providers implement the same interface; the `stub` provider returns
// deterministic test data so the entire round flow works without API keys.
//
// Design principles:
//   1. One provider instance per process (see `getAiProvider`).
//   2. Every call returns a typed result + cost metadata (for per-round economics).
//   3. Errors from upstream services are wrapped in ApiError(UPSTREAM).
//   4. Stub mode is zero-cost and deterministic — ideal for UI development.

import { env } from '@talqyla/config';
import { ApiError } from '../lib/errors.js';

// ─── LLM types (OpenRouter chat completions) ───────────────────────

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  model: string;
  system: string;
  messages: LlmMessage[];
  /** If true, ask the model to respond in valid JSON. */
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  /**
   * Mark the system prompt as cacheable (Anthropic prompt caching).
   * Only worth it for long, byte-identical system prompts.
   */
  cacheSystem?: boolean;
}

export interface LlmResult {
  text: string;
  /** Prompt tokens (input) — from usage field. */
  tokensIn: number;
  /** Completion tokens (output) — from usage field. */
  tokensOut: number;
  /** USD cost. Reported by OpenRouter when available, else estimated. */
  costUsd: number;
  /**
   * Where costUsd came from. A hardcoded price table drifts the moment a
   * provider changes pricing, so we track which number we actually used.
   */
  costSource: 'provider' | 'estimate';
}

// ─── STT types (speech → text) ────────────────────────────────────

export interface SttOptions {
  /** Audio bytes (webm/mp3/wav). */
  audio: Buffer;
  /** MIME type from the upload. */
  mimeType: string;
  /** Language hint (default 'ru'). */
  language?: string;
}

export interface SttResult {
  text: string;
  durationSec: number;
  /** Which provider handled the request. */
  provider: string;
}

// ─── TTS types (text → opponent voice audio) ──────────────────────

export interface TtsOptions {
  text: string;
  voice?: string;
}

export interface TtsResult {
  /** Audio buffer (mp3). */
  audio: Buffer;
  contentType: string;
  /** Which provider handled the request. */
  provider: string;
  /** Characters actually synthesised — TTS is billed per character. */
  chars: number;
}

// ─── Provider interface ────────────────────────────────────────────

export interface AiProvider {
  llm: {
    complete(opts: LlmOptions): Promise<LlmResult>;
  };
  stt: {
    transcribe(opts: SttOptions): Promise<SttResult>;
  };
  tts: {
    synthesize(opts: TtsOptions): Promise<TtsResult>;
  };
}

// ─── OpenRouter LLM implementation ───────────────────────────────
// Docs: https://openrouter.ai/docs/api-reference/chat-completion

/** Stub LLM — returns deterministic responses for UI development without API keys. */
function createStubLlm() {
  return async function complete(opts: LlmOptions): Promise<LlmResult> {
    if (opts.jsonMode) {
      // The judge prompt is the only one that asks for a `scores` array.
      const isJudge = opts.system.includes('AI-судья');
      const json = isJudge
        ? {
            scores: [
              { skill: 'STRUCTURE', score: 7, comment: 'Хорошая структура аргумента.' },
              { skill: 'CONTENT', score: 6, comment: 'Достаточно фактов, но можно больше.' },
              { skill: 'REFUTATION', score: 5, comment: 'Опровержение есть, но не полное.' },
              { skill: 'LOGIC', score: 7, comment: 'Логика в целом верная.' },
              { skill: 'DELIVERY', score: 6, comment: 'Хорошая подача.' },
            ],
            strengths: ['Чёткая структура Claim-Warrant-Impact', 'Уверенная подача'],
            weaknesses: ['Не хватает фактов и статистики', 'Опровержение аргументов оппонента поверхностно'],
            advice: ['Используй больше конкретных примеров', 'Слушай оппонента внимательнее и отвечай на его пункты'],
            summaryText: 'Ровный раунд: структура есть, доказательной базы не хватает.',
          }
        : {
            text: 'Понимаю твою позицию, но ты сказал «домашние задания не приносят пользы» — это утверждение без данных. Исследования показывают обратное для старших классов.',
            kind: 'REBUTTAL',
            question: 'На какие исследования ты опираешься?',
            citationRefs: ['домашние задания не приносят пользы'],
          };
      return { text: JSON.stringify(json), tokensIn: 150, tokensOut: 120, costUsd: 0, costSource: 'estimate' };
    }
    return {
      text: 'Я считаю, что это сложный вопрос, требующий всестороннего рассмотрения. У вашей позиции есть сильные стороны, но также и уязвимости, которые стоит проработать.',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0,
      costSource: 'estimate',
    };
  };
}

/**
 * Fallback price table (USD per token), used ONLY when OpenRouter does not
 * report an actual cost. Verified 2026-07. Treat as an estimate, not truth —
 * `costSource` tells you which one you got.
 */
const LLM_PRICING: Record<string, { input: number; output: number }> = {
  'anthropic/claude-haiku-4.5': { input: 1.0e-6, output: 5.0e-6 },
  'anthropic/claude-sonnet-4.5': { input: 3.0e-6, output: 15.0e-6 },
  'anthropic/claude-3.5-haiku': { input: 0.8e-6, output: 4.0e-6 },
  'anthropic/claude-3.5-sonnet': { input: 3.0e-6, output: 15.0e-6 },
};

// Anthropic only starts caching at ~2048 prompt tokens for Haiku-class models.
// Below that a cache_control breakpoint is a no-op — not a bug, just physics.
const CACHE_MIN_CHARS = 6000;

function createOpenRouterLlm() {
  const baseUrl = env.LLM_BASE_URL;
  const apiKey = env.OPENROUTER_API_KEY;
  const referer = env.LLM_REFERER;
  const appTitle = env.LLM_APP_TITLE;

  return async function complete(opts: LlmOptions): Promise<LlmResult> {
    if (!apiKey) {
      throw ApiError.upstream('OPENROUTER_API_KEY не задан. Задай ключ или оставь провайдеры в режиме stub.');
    }

    const isAnthropic = opts.model.includes('anthropic/');
    // Only claim caching when we actually place a breakpoint. The previous
    // version sent the beta header with no cache_control, which did nothing.
    const useCache = Boolean(opts.cacheSystem) && isAnthropic && opts.system.length >= CACHE_MIN_CHARS;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': referer,
      'X-Title': appTitle,
    };
    if (useCache) headers['anthropic-beta'] = 'prompt-caching-2024-07-31';

    const systemMessage = useCache
      ? {
          role: 'system',
          content: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
        }
      : { role: 'system', content: opts.system };

    const body: Record<string, unknown> = {
      model: opts.model,
      messages: [systemMessage, ...opts.messages],
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
      // Ask OpenRouter for the real billed cost instead of guessing from a
      // price table that goes stale the moment a provider changes pricing.
      usage: { include: true },
    };

    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw ApiError.upstream(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };

    const text = json.choices[0]?.message?.content ?? '';
    const tokensIn = json.usage?.prompt_tokens ?? 0;
    const tokensOut = json.usage?.completion_tokens ?? 0;

    if (typeof json.usage?.cost === 'number') {
      return { text, tokensIn, tokensOut, costUsd: json.usage.cost, costSource: 'provider' };
    }

    const pricing = LLM_PRICING[opts.model] ?? LLM_PRICING['anthropic/claude-haiku-4.5'];
    return {
      text,
      tokensIn,
      tokensOut,
      costUsd: tokensIn * pricing.input + tokensOut * pricing.output,
      costSource: 'estimate',
    };
  };
}

// ─── STT implementations ─────────────────────────────────────────

/** Stub STT — returns deterministic Russian text for UI development. */
function createStubStt() {
  return async function transcribe(_opts: SttOptions): Promise<SttResult> {
    return {
      text: 'Я считаю, что домашние задания необходимо запретить. Во-первых, они создают огромный стресс для школьников, которые уже перегружены уроками и кружками. Во-вторых, домашние задания часто не приносят реальной пользы — многие ученики просто копируют ответы у одноклассников или в интернете, не вникая в материал. И наконец, время, которое тратится на домашние задания, можно было бы потратить на полноценный отдых, хобби или общение с семьёй, что важнее для развития личности.',
      durationSec: 45,
      provider: 'stub',
    };
  };
}

/** Groq STT — Whisper-large-v3, fast and cheap. */
function createGroqStt() {
  const apiKey = env.GROQ_API_KEY;

  return async function transcribe(opts: SttOptions): Promise<SttResult> {
    if (!apiKey) {
      throw ApiError.upstream('GROQ_API_KEY не задан.');
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(opts.audio)], { type: opts.mimeType });
    formData.append('file', blob, 'audio.webm');
    formData.append('language', opts.language ?? 'ru');
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'verbose_json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw ApiError.upstream(`Groq STT ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { text?: string; duration?: number };
    return { text: json.text ?? '', durationSec: json.duration ?? 0, provider: 'groq' };
  };
}

/** OpenAI STT — Whisper-1 fallback. */
function createOpenAiStt() {
  const apiKey = env.OPENAI_API_KEY;

  return async function transcribe(opts: SttOptions): Promise<SttResult> {
    if (!apiKey) {
      throw ApiError.upstream('OPENAI_API_KEY не задан.');
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(opts.audio)], { type: opts.mimeType });
    formData.append('file', blob, 'audio.webm');
    formData.append('language', opts.language ?? 'ru');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw ApiError.upstream(`OpenAI STT ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { text?: string; duration?: number };
    return { text: json.text ?? '', durationSec: json.duration ?? 0, provider: 'openai' };
  };
}

function createStt(): { transcribe: (opts: SttOptions) => Promise<SttResult> } {
  switch (env.STT_PROVIDER) {
    case 'groq':
      return { transcribe: createGroqStt() };
    case 'openai':
      return { transcribe: createOpenAiStt() };
    case 'stub':
    default:
      return { transcribe: createStubStt() };
  }
}

// ─── TTS implementations ─────────────────────────────────────────

/**
 * TTS is billed per character and is ~50% of per-round COGS. Truncate at the
 * provider boundary as well as at the route — belt and braces, because every
 * caller of this method spends real money.
 */
function capTtsText(text: string): string {
  return text.length > env.TTS_MAX_CHARS ? `${text.slice(0, env.TTS_MAX_CHARS - 1)}…` : text;
}

/** Stub TTS — returns a minimal silent mp3 placeholder. */
function createStubTts() {
  const SILENT_MP3 = Buffer.from(
    'ID3' +
      '\x03\x00\x00\x00\x00\x00\x00\x00' +
      '\xff\xfb\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
    'binary',
  );

  return async function synthesize(opts: TtsOptions): Promise<TtsResult> {
    return {
      audio: SILENT_MP3,
      contentType: 'audio/mpeg',
      provider: 'stub',
      chars: capTtsText(opts.text).length,
    };
  };
}

/** OpenAI TTS — tts-1 model. */
function createOpenAiTts() {
  const apiKey = env.OPENAI_API_KEY;

  return async function synthesize(opts: TtsOptions): Promise<TtsResult> {
    if (!apiKey) {
      throw ApiError.upstream('OPENAI_API_KEY не задан.');
    }

    const input = capTtsText(opts.text);

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        input,
        voice: opts.voice ?? env.TTS_VOICE,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw ApiError.upstream(`OpenAI TTS ${res.status}: ${text.slice(0, 200)}`);
    }

    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, contentType: 'audio/mpeg', provider: 'openai', chars: input.length };
  };
}

function createTts(): { synthesize: (opts: TtsOptions) => Promise<TtsResult> } {
  switch (env.TTS_PROVIDER) {
    case 'openai':
      return { synthesize: createOpenAiTts() };
    case 'elevenlabs':
      return { synthesize: createStubTts() };
    case 'stub':
    default:
      return { synthesize: createStubTts() };
  }
}

// ─── Factory: create the provider singleton ────────────────────────

export function createAiProvider(): AiProvider {
  const llm = env.OPENROUTER_API_KEY ? createOpenRouterLlm() : createStubLlm();
  return {
    llm: { complete: llm },
    stt: { transcribe: createStt().transcribe },
    tts: { synthesize: createTts().synthesize },
  };
}

let singleton: AiProvider | null = null;

/** Process-wide provider. Prefer this over calling createAiProvider() again. */
export function getAiProvider(): AiProvider {
  if (!singleton) singleton = createAiProvider();
  return singleton;
}
