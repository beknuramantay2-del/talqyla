// AI provider abstraction — single entry point for all LLM/STT/TTS calls.
//
// Every provider is selected via env vars (STT_PROVIDER, TTS_PROVIDER).
// All providers implement the same interface; the `stub` provider returns
// deterministic test data so the entire round flow works without API keys.
//
// Design principles:
//   1. One provider instance per process (created in index.ts, shared everywhere).
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
}

export interface LlmResult {
  text: string;
  /** Prompt tokens (input) — from usage field. */
  tokensIn: number;
  /** Completion tokens (output) — from usage field. */
  tokensOut: number;
  /** Estimated USD cost based on model pricing. */
  costUsd: number;
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
//
// OpenRouter wraps Anthropic/OpenAI/etc behind a unified chat-completions API.
// For Anthropic models it supports prompt caching via the anthropic-beta header.

/** Stub LLM — returns deterministic responses for UI development without API keys. */
function createStubLlm() {
  return async function complete(opts: LlmOptions): Promise<LlmResult> {
    const isJudge = opts.model.includes('sonnet');
    if (opts.jsonMode) {
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
          }
        : {
            text: 'Я понимаю вашу точку зрения, но позвольте предложить другой взгляд на эту проблему. Ваш аргумент основан на предположении, которое не учитывает несколько важных факторов. Во-первых, статистика показывает обратное — согласно последним исследованиям, большинство экспертов сходятся во мнении, что ситуация сложнее, чем кажется на первый взгляд.',
            question: 'Как вы можете обосновать ваше утверждение с учётом этих данных?',
            citationRefs: ['аргумент ученика об утверждении'],
          };
      return {
        text: JSON.stringify(json),
        tokensIn: 150,
        tokensOut: 120,
        costUsd: 0,
      };
    }
    return {
      text: 'Я считаю, что это сложный вопрос, требующий всестороннего рассмотрения. У вашей позиции есть сильные стороны, но также и уязвимости, которые стоит проработать.',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0,
    };
  };
}

const LLM_PRICING: Record<string, { input: number; output: number }> = {
  'anthropic/claude-3.5-haiku': { input: 1.0e-6, output: 5.0e-6 }, // $1/$5 per MTok
  'anthropic/claude-3.5-sonnet': { input: 3.0e-6, output: 15.0e-6 }, // $3/$15 per MTok
};

function createOpenRouterLlm() {
  const baseUrl = env.LLM_BASE_URL;
  const apiKey = env.OPENROUTER_API_KEY;
  const referer = env.LLM_REFERER;
  const appTitle = env.LLM_APP_TITLE;

  return async function complete(opts: LlmOptions): Promise<LlmResult> {
    if (!apiKey) {
      throw ApiError.upstream('OPENROUTER_API_KEY не задан. Задай ключ или используй STT_PROVIDER=stub для разработки.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': referer,
      'X-Title': appTitle,
    };

    // Enable Anthropic prompt caching when using Claude models.
    if (opts.model.includes('anthropic/claude')) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
    }

    const body: Record<string, unknown> = {
      model: opts.model,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
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
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = json.choices[0]?.message?.content ?? '';
    const tokensIn = json.usage?.prompt_tokens ?? 0;
    const tokensOut = json.usage?.completion_tokens ?? 0;

    const pricing = LLM_PRICING[opts.model] ?? { input: 3.0e-6, output: 15.0e-6 };
    const costUsd = tokensIn * pricing.input + tokensOut * pricing.output;

    return { text, tokensIn, tokensOut, costUsd };
  };
}

// ─── STT implementations ─────────────────────────────────────────

/** Stub STT — returns deterministic Russian text for UI development. */
function createStubStt() {
  return async function transcribe(_opts: SttOptions): Promise<SttResult> {
    // Simulates a 90-second speech with plausible debate content.
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
    return {
      text: json.text ?? '',
      durationSec: json.duration ?? 0,
      provider: 'groq',
    };
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
    return {
      text: json.text ?? '',
      durationSec: json.duration ?? 0,
      provider: 'openai',
    };
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

/** Stub TTS — returns a minimal silent mp3 placeholder. */
function createStubTts() {
  // Minimal valid mp3 frame (silent, ~0.1s). Generated once, reused.
  // ID3 header + MPEG frame (MPEG1 Layer3, 128kbps, 44100Hz, mono).
  const SILENT_MP3 = Buffer.from(
    'ID3' +
      // ID3v2.3 header: 10 bytes
      '\x03\x00\x00\x00\x00\x00\x00\x00' +
      // Minimal MPEG audio frame
      '\xff\xfb\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
    'binary',
  );

  return async function synthesize(_opts: TtsOptions): Promise<TtsResult> {
    return {
      audio: SILENT_MP3,
      contentType: 'audio/mpeg',
      provider: 'stub',
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

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: opts.text,
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
    return { audio, contentType: 'audio/mpeg', provider: 'openai' };
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
