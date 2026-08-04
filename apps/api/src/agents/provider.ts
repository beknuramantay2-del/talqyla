// AI provider abstraction — единственная точка входа для LLM/STT/TTS.
//
// Принципы:
//   1. Один экземпляр на процесс (см. getAiProvider).
//   2. Каждый вызов возвращает типизированный результат + метаданные стоимости.
//   3. Ошибки апстрима заворачиваются в ApiError(UPSTREAM).
//   4. stub-режим бесплатный и детерминированный — на нём разрабатывается UI.
//
// Цены живут в lib/pricing.ts и больше нигде: раньше таблица дублировалась
// здесь, а аудио не тарифицировалось вообще.

import { env } from '@talqyla/config';
import { ApiError } from '../lib/errors.js';
import { DEFAULT_LLM_MODEL, llmCostUsd } from '../lib/pricing.js';

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
  /** Legacy-флаг из v1. Оставлен, чтобы старые агенты компилировались. */
  cacheSystem?: boolean;
}

export interface LlmResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Откуда взялась цена: реальная от OpenRouter или наша оценка. */
  costSource: 'provider' | 'estimate';
}

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
}

export interface TtsOptions {
  text: string;
  voice?: string;
}

export interface TtsResult {
  audio: Buffer;
  contentType: string;
  provider: string;
  model: string;
  /** Символы, реально отправленные в синтез: тарификация посимвольная. */
  chars: number;
}

export interface AiProvider {
  llm: { complete(opts: LlmOptions): Promise<LlmResult> };
  stt: { transcribe(opts: SttOptions): Promise<SttResult> };
  tts: { synthesize(opts: TtsOptions): Promise<TtsResult> };
}

// ─── Stub LLM ─────────────────────────────────────────────────────

function createStubLlm() {
  return async function complete(opts: LlmOptions): Promise<LlmResult> {
    if (opts.jsonMode) {
      const isJudge = opts.system.includes('судья');
      const isCase = opts.system.includes('карту кейса');
      const json = isJudge
        ? {
            scores: [
              { skill: 'STRUCTURE', score: 7, comment: 'Каркас слышен, переходы есть.' },
              { skill: 'CASE_ANALYSIS', score: 5, comment: 'Механизм назван, сравнения миров нет.' },
              { skill: 'REFUTATION', score: 4, comment: 'Ответ противоположной линии поверхностный.' },
              { skill: 'QUICK_THINKING', score: 6, comment: 'На POI ответил, но потерял темп.' },
              { skill: 'CONTENT', score: 6, comment: 'Пример есть, данных не хватает.' },
            ],
            strengths: ['Чёткий вывод: «запрет решает причину, а не симптом»'],
            weaknesses: ['Нет ответа на главный clash: «это просто неудобно» — не аргумент'],
            drill: {
              skill: 'REFUTATION',
              task: 'За 60 секунд назови сильнейший аргумент оппонента и разбей его одним примером.',
            },
            summaryText: 'Структура держится, опровержение проседает.',
          }
        : isCase
          ? {
              stakeholders: ['Подростки 13–16', 'Родители', 'Школы', 'Платформы'],
              clashes: [
                { title: 'Кто отвечает за вред', gov: 'Платформа проектирует зависимость', opp: 'Ответственность на семье и школе' },
                { title: 'Работает ли запрет', gov: 'Ограничение снижает экспозицию', opp: 'Обход через чужие аккаунты' },
              ],
              govLines: ['Алгоритмы усиливают тревожность через сравнение', 'Возрастной порог уже работает в других сферах'],
              oppLines: ['Соцсети — основной канал общения и поддержки', 'Запрет вытесняет в нерегулируемые площадки'],
              traps: ['Подмена корреляции причинностью', 'Спор с крайней версией позиции оппонента'],
            }
          : { question: 'На какие данные ты опираешься в этом утверждении?' };
      return { text: JSON.stringify(json), tokensIn: 150, tokensOut: 120, costUsd: 0, costSource: 'estimate' };
    }
    return { text: 'Заглушка ответа модели для разработки UI.', tokensIn: 100, tokensOut: 50, costUsd: 0, costSource: 'estimate' };
  };
}

// ─── OpenRouter LLM ───────────────────────────────────────────────

function createOpenRouterLlm() {
  const baseUrl = env.LLM_BASE_URL;
  const apiKey = env.OPENROUTER_API_KEY;

  return async function complete(opts: LlmOptions): Promise<LlmResult> {
    if (!apiKey) {
      throw ApiError.upstream('OPENROUTER_API_KEY не задан. Задай ключ или оставь провайдеры в режиме stub.');
    }

    const body: Record<string, unknown> = {
      model: opts.model,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
      max_tokens: opts.maxTokens ?? 900,
      temperature: opts.temperature ?? 0.3,
      // Просим реальную списанную стоимость вместо догадки по таблице.
      usage: { include: true },
    };
    if (opts.jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': env.LLM_REFERER,
        'X-Title': env.LLM_APP_TITLE,
      },
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
    return {
      text,
      tokensIn,
      tokensOut,
      costUsd: llmCostUsd(opts.model || DEFAULT_LLM_MODEL, tokensIn, tokensOut),
      costSource: 'estimate',
    };
  };
}

// ─── STT ──────────────────────────────────────────────────────────

function createStubStt() {
  return async function transcribe(_opts: SttOptions): Promise<SttResult> {
    return {
      text: 'Уважаемые судьи, наша позиция в том, что ограничение решает причину проблемы, а не её симптом. Во-первых, платформы проектируют вовлечение намеренно. Во-вторых, у школ нет инструментов противодействия. Поэтому регулирование эффективнее просветительских кампаний.',
      durationSec: 45,
      provider: 'stub',
      model: 'stub',
    };
  };
}

function createGroqStt() {
  const apiKey = env.GROQ_API_KEY;
  // Модель вынесена в env: turbo дешевле large-v3 в 2.8 раза при том же WER
  // на русском, а раньше значение было зашито в код мимо таблицы цен.
  const model = env.GROQ_STT_MODEL;

  return async function transcribe(opts: SttOptions): Promise<SttResult> {
    if (!apiKey) throw ApiError.upstream('GROQ_API_KEY не задан.');

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(opts.audio)], { type: opts.mimeType }), 'audio.webm');
    formData.append('language', opts.language ?? 'ru');
    formData.append('model', model);
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
    return { text: json.text ?? '', durationSec: json.duration ?? 0, provider: 'groq', model };
  };
}

function createOpenAiStt() {
  const apiKey = env.OPENAI_API_KEY;
  const model = 'whisper-1';

  return async function transcribe(opts: SttOptions): Promise<SttResult> {
    if (!apiKey) throw ApiError.upstream('OPENAI_API_KEY не задан.');

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(opts.audio)], { type: opts.mimeType }), 'audio.webm');
    formData.append('language', opts.language ?? 'ru');
    formData.append('model', model);
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
    return { text: json.text ?? '', durationSec: json.duration ?? 0, provider: 'openai', model };
  };
}

function createStt(): { transcribe: (opts: SttOptions) => Promise<SttResult> } {
  switch (env.STT_PROVIDER) {
    case 'groq':
      return { transcribe: createGroqStt() };
    case 'openai':
      return { transcribe: createOpenAiStt() };
    default:
      return { transcribe: createStubStt() };
  }
}

// ─── TTS ──────────────────────────────────────────────────────────

/** Обрезаем на границе провайдера тоже: каждый вызов тратит реальные деньги. */
function capTtsText(text: string): string {
  return text.length > env.TTS_MAX_CHARS ? `${text.slice(0, env.TTS_MAX_CHARS - 1)}…` : text;
}

function createStubTts() {
  const SILENT_MP3 = Buffer.from('ID3\u0003', 'binary');
  return async function synthesize(opts: TtsOptions): Promise<TtsResult> {
    return { audio: SILENT_MP3, contentType: 'audio/mpeg', provider: 'stub', model: 'stub', chars: capTtsText(opts.text).length };
  };
}

function createOpenAiTts() {
  const apiKey = env.OPENAI_API_KEY;
  return async function synthesize(opts: TtsOptions): Promise<TtsResult> {
    if (!apiKey) throw ApiError.upstream('OPENAI_API_KEY не задан.');
    const input = capTtsText(opts.text);

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'tts-1', input, voice: opts.voice ?? env.TTS_VOICE, response_format: 'mp3' }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw ApiError.upstream(`OpenAI TTS ${res.status}: ${text.slice(0, 200)}`);
    }

    return { audio: Buffer.from(await res.arrayBuffer()), contentType: 'audio/mpeg', provider: 'openai', model: 'tts-1', chars: input.length };
  };
}

function createTts(): { synthesize: (opts: TtsOptions) => Promise<TtsResult> } {
  // elevenlabs пока не подключён: роут отдаёт понятную ошибку раньше, чем
  // управление дойдёт сюда.
  return env.TTS_PROVIDER === 'openai' ? { synthesize: createOpenAiTts() } : { synthesize: createStubTts() };
}

export function createAiProvider(): AiProvider {
  const llm = env.OPENROUTER_API_KEY ? createOpenRouterLlm() : createStubLlm();
  return { llm: { complete: llm }, stt: { transcribe: createStt().transcribe }, tts: { synthesize: createTts().synthesize } };
}

let singleton: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (!singleton) singleton = createAiProvider();
  return singleton;
}
