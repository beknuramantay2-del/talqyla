// Единая таблица цен на AI. Проверено 2026-08.
//
// Раньше цены жили в трёх местах: таблица LLM внутри provider.ts, комментарии в
// .env.example и НИГДЕ для аудио. Аудио не тарифицировалось вообще, поэтому STT и
// TTS не попадали ни в один бюджет. Теперь все цены здесь, и только здесь.

/**
 * USD за токен. Фолбэк: используется, только если OpenRouter не вернул реальную
 * стоимость в usage.cost. Хардкод цен всегда протухает, поэтому costSource
 * говорит, какое число мы использовали на самом деле.
 */
export const LLM_PRICING: Record<string, { input: number; output: number }> = {
  'anthropic/claude-haiku-4.5': { input: 1.0e-6, output: 5.0e-6 },
  'anthropic/claude-sonnet-4.5': { input: 3.0e-6, output: 15.0e-6 },
  'anthropic/claude-3.5-haiku': { input: 0.8e-6, output: 4.0e-6 },
  'anthropic/claude-3.5-sonnet': { input: 3.0e-6, output: 15.0e-6 },
};

export const DEFAULT_LLM_MODEL = 'anthropic/claude-haiku-4.5';

export function llmCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = LLM_PRICING[model] ?? LLM_PRICING[DEFAULT_LLM_MODEL];
  return tokensIn * price.input + tokensOut * price.output;
}

/**
 * USD за секунду аудио, ключ — `провайдер:модель`.
 * Выходной токен LLM стоит в 5 раз дороже входного, а секунда аудио — копейки,
 * поэтому голосовой ВВОД дешёвый. Дорогая всегда озвучка, см. ниже.
 */
export const STT_PRICE_PER_SECOND: Record<string, number> = {
  // $0.04/час. Дефолт: на русском WER практически как у large-v3,
  // а платим в 2.8 раза меньше.
  'groq:whisper-large-v3-turbo': 0.04 / 3600,
  'groq:whisper-large-v3': 0.111 / 3600,
  // $0.006/минута = $0.36/час. В 9 раз дороже turbo. Только как запасной путь.
  'openai:whisper-1': 0.006 / 60,
  'stub:stub': 0,
};

/**
 * USD за символ. Это самая дорогая часть раунда: одна реплика оппонента в 420
 * символов стоит дороже, чем весь ход модели, который её придумал.
 */
export const TTS_PRICE_PER_CHAR: Record<string, number> = {
  // $15 за 1M символов.
  'openai:tts-1': 15 / 1_000_000,
  // Ориентир $120 за 1M символов. Хук заложен, провайдер не подключён.
  'elevenlabs:default': 120 / 1_000_000,
  'stub:stub': 0,
};

export function sttCostUsd(provider: string, model: string, seconds: number): number {
  return (STT_PRICE_PER_SECOND[`${provider}:${model}`] ?? 0) * Math.max(0, seconds);
}

export function ttsCostUsd(provider: string, model: string, chars: number): number {
  return (TTS_PRICE_PER_CHAR[`${provider}:${model}`] ?? 0) * Math.max(0, chars);
}

/**
 * Ожидаемая стоимость одного текстового раунда: 3 хода оппонента + судья.
 * Нужна, чтобы отказать ДО первого платного вызова, а не после четвёртого.
 */
export const EST_ROUND_USD = 0.02;

/**
 * Оценка длительности аудио по размеру файла. Браузер пишет webm/opus примерно
 * в 20 КБ/с. Точную длительность знает только провайдер, но списывать бюджет
 * нужно ДО отправки, поэтому здесь сознательно грубая верхняя оценка.
 */
export function estimateAudioSeconds(bytes: number): number {
  return Math.ceil(bytes / 20_000);
}
