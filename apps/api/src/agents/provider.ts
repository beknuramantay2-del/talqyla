// AI provider abstraction — single entry point for all LLM/STT/TTS calls.
//
// Every result carries provider, model and billable units so the caller can
// write an exact UsageEvent. Nothing here touches the database: metering is
// the caller's job, pricing lives in lib/pricing.ts, and this file only knows
// how to talk to upstreams.
//
// `stub` providers are zero-cost and deterministic, so the whole flow runs
// without a single API key.

import { env } from '@talqyla/config';
import { ApiError } from '../lib/errors.js';
import { LLM_PRICING, DEFAULT_LLM_MODEL, sttCostUsd, ttsCostUsd } from '../lib/pricing.js';

// ─── LLM types ─────────────────────────────────────────

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  model: string;
  system: string;
  messages: LlmMessage[];
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Where costUsd came from. A hardcoded table drifts; this says which we used. */
  costSource: 'provider' | 'estimate';
  model: string;
}

// ─── STT types ─────────────────────────────────────────

export interface SttOptions {
  audio: Buffer;
  mimeType: string;
  language?: string;
}

export interface SttResult {
  text: string;
  durationSec: number;
  provider: string;
  model: string;
  costUsd: number;
}

// ─── TTS types ─────────────────────────────────────────

export interface TtsOptions {
  text: string;
  voice?: string;
}

export interface TtsResult {
  audio: Buffer;
  contentType: string;
  provider: string;
  model: string;
  /** Characters actually synthesised. TTS is billed per character. */
  chars: number;
  costUsd: number;
}

export interface AiProvider {
  llm: { complete(opts: LlmOptions): Promise<LlmResult> };
  stt: { transcribe(opts: SttOptions): Promise<SttResult> };
  tts: { synthesize(opts: TtsOptions): Promise<TtsResult> };
}

// ─── LLM: stub ─────────────────────────────────────────

const STUB_JUDGE = {
  scores: [
    { skill: 'STRUCTURE', score: 7, comment: 'Есть заявка, обоснование и вывод.' },
    { skill: 'CASE_ANALYSIS', score: 5, comment: 'Стейкхолдеры названы, но не взвешены.' },
    { skill: 'REFUTATION', score: 5, comment: 'Ответ на вопрос есть, но поверхностный.' },
    { skill: 'SPEED', score: 6, comment: 'Пауза перед ответом на POI около четырёх секунд.' },
    { skill: 'ARGUMENTATION', score: 6, comment: 'Причина есть, примера не хватает.' },
  ],
  strengths: ['Чёткое начало: «я утверждаю, что запрет не решает причину»'],
  weaknesses: ['«Это очевидно вредно» — заявлено без механизма и без данных'],
  advice: ['Назови clash до того, как отвечаешь', 'Добавь один пример на каждый аргумент'],
  summaryText: 'Ровная речь: структура держится, глубины кейса не хватает.',
  drillSkill: 'CASE_ANALYSIS',
  drillPrompt: 'За 60 секунд назови трёх стейкхолдеров этой темы и то, что каждый теряет.',
};

const STUB_OPPONENT = {
  text: 'Ты сказал «домашние задания не приносят пользы» — это утверждение без механизма.',
  kind: 'QUESTION',
  question: 'Почему отмена меняет результат, а не просто убирает нагрузку?',
  citationRefs: ['домашние задания не приносят пользы'],
};

const STUB_CASE = {
  stakeholders: ['Школьники 12–16 лет', 'Родители', 'Школа и учителя', 'Платформы'],
  clashes: ['Защита ребёнка против его автономии', 'Работает ли запрет технически'],
  proArguments: ['Снижает вред алгоритмической ленты', 'Даёт время на офлайн-навыки'],
  conArguments: ['Запрет обходится за минуту', 'Изоляция от круга общения'],
  traps: ['Спорить про вред интернета вообще вместо возраста 16'],
};

function createStubLlm() {
  return async function complete(opts: LlmOptions): Promise<LlmResult> {
    const base = {
      tokensIn: 150,
      tokensOut: 120,
      costUsd: 0,
      costSource: 'estimate' as const,
      model: opts.model,
    };
    if (!opts.jsonMode) {
      return { ...base, text: 'Заглушка ответа для разработки интерфейса без ключей.' };
    }
    const isJudge = opts.system.includes('AI-судья');
    const isCase = opts.system.includes('кейс-карту');
    const payload = isJudge ? STUB_JUDGE : isCase ? STUB_CASE : STUB_OPPONENT;
    return { ...base, text: JSON.stringify(payload) };
  };
}

// ─── LLM: OpenRouter ───────────────────────────────────────

function createOpenRouterLlm() {
  return async function complete(opts: LlmOptions): Promise<LlmResult> {
    if (!env.OPENROUTER_API_KEY) {
      throw ApiError.upstream('OPENROUTER_API_KEY не задан. Задай ключ или оставь провайдеры в режиме stub.');
    }

    const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': env.LLM_REFERER,
        'X-Title': env.LLM_APP_TITLE,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'system', content: opts.system }, ...opts.messages],
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.3,
        // Ask for the real billed cost instead of guessing from a stale table.
        usage: { include: true },
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
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
      return {
        text,
        tokensIn,
        tokensOut,
        costUsd: json.usage.cost,
        costSource: 'provider',
        model: opts.model,
      };
    }

    const pricing = LLM_PRICING[opts.model] ?? LLM_PRICING[DEFAULT_LLM_MODEL];
    return {
      text,
      tokensIn,
      tokensOut,
      costUsd: tokensIn * pricing.input + tokensOut * pricing.output,
      costSource: 'estimate',
      model: opts.model,
    };
  };
}

// ─── STT ───────────────────────────────────────────────

const STUB_TRANSCRIPT =
  'Я утверждаю, что возрастной запрет не решает причину проблемы. Во-первых, вред идёт от алгоритмической ленты, а не от самого факта общения. Во-вторых, запрет обходится за минуту, значит он бьёт по законопослушным. Поэтому регулировать нужно алгоритм, а не возраст.';

function createStubStt() {
  return async function transcribe(_opts: SttOptions): Promise<SttResult> {
    return { text: STUB_TRANSCRIPT, durationSec: 45, provider: 'stub', model: 'stub', costUsd: 0 };
  };
}

async function postAudio(
  url: string,
  apiKey: string,
  model: string,
  opts: SttOptions,
  timeoutMs: number,
): Promise<{ text?: string; duration?: number }> {
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(opts.audio)], { type: opts.mimeType }), 'audio.webm');
  formData.append('language', opts.language ?? 'ru');
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw ApiError.upstream(`STT ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as { text?: string; duration?: number };
}

function createGroqStt() {
  return async function transcribe(opts: SttOptions): Promise<SttResult> {
    if (!env.GROQ_API_KEY) throw ApiError.upstream('GROQ_API_KEY не задан.');
    const model = env.GROQ_STT_MODEL;
    const json = await postAudio(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      env.GROQ_API_KEY,
      model,
      opts,
      30_000,
    );
    const durationSec = Math.ceil(json.duration ?? 0);
    return {
      text: json.text ?? '',
      durationSec,
      provider: 'groq',
      model,
      costUsd: sttCostUsd('groq', model, durationSec),
    };
  };
}

function createOpenAiStt() {
  return async function transcribe(opts: SttOptions): Promise<SttResult> {
    if (!env.OPENAI_API_KEY) throw ApiError.upstream('OPENAI_API_KEY не задан.');
    const json = await postAudio(
      'https://api.openai.com/v1/audio/transcriptions',
      env.OPENAI_API_KEY,
      'whisper-1',
      opts,
      60_000,
    );
    const durationSec = Math.ceil(json.duration ?? 0);
    return {
      text: json.text ?? '',
      durationSec,
      provider: 'openai',
      model: 'whisper-1',
      costUsd: sttCostUsd('openai', 'whisper-1', durationSec),
    };
  };
}

function createStt() {
  switch (env.STT_PROVIDER) {
    case 'groq':
      return { transcribe: createGroqStt() };
    case 'openai':
      return { transcribe: createOpenAiStt() };
    default:
      return { transcribe: createStubStt() };
  }
}

// ─── TTS ──────────────────────────────────────────────

/** TTS is billed per character. Cap at the provider boundary too. */
function capTtsText(text: string): string {
  return text.length > env.TTS_MAX_CHARS ? `${text.slice(0, env.TTS_MAX_CHARS - 1)}\u2026` : text;
}

function createStubTts() {
  const SILENT_MP3 = Buffer.from('ID3\u0003', 'binary');
  return async function synthesize(opts: TtsOptions): Promise<TtsResult> {
    const input = capTtsText(opts.text);
    return {
      audio: SILENT_MP3,
      contentType: 'audio/mpeg',
      provider: 'stub',
      model: 'stub',
      chars: input.length,
      costUsd: 0,
    };
  };
}

function createOpenAiTts() {
  return async function synthesize(opts: TtsOptions): Promise<TtsResult> {
    if (!env.OPENAI_API_KEY) throw ApiError.upstream('OPENAI_API_KEY не задан.');
    const input = capTtsText(opts.text);

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
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

    return {
      audio: Buffer.from(await res.arrayBuffer()),
      contentType: 'audio/mpeg',
      provider: 'openai',
      model: 'tts-1',
      chars: input.length,
      costUsd: ttsCostUsd('openai', 'tts-1', input.length),
    };
  };
}

function createTts() {
  // ElevenLabs is a priced hook, not an integration. The route returns an
  // explicit 502 for it; silently falling back to stub would be worse.
  return env.TTS_PROVIDER === 'openai' ? { synthesize: createOpenAiTts() } : { synthesize: createStubTts() };
}

// ─── Factory ───────────────────────────────────────────

export function createAiProvider(): AiProvider {
  return {
    llm: { complete: env.OPENROUTER_API_KEY ? createOpenRouterLlm() : createStubLlm() },
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
