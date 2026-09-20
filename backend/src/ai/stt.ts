import { sttConfig } from '../config.js';

type SttResult = {
  text: string;
  provider: 'openai' | 'deepgram' | 'groq' | 'none';
  model: string;
  fallback: boolean;
};

type OpenAiKeyState = {
  key: string;
  slot: number;
  inFlight: number;
  cooldownUntil: number;
  lastUsed: number;
};

const openAiKeys: OpenAiKeyState[] = sttConfig.openAiApiKeys.map((key, index) => ({
  key,
  slot: index + 1,
  inFlight: 0,
  cooldownUntil: 0,
  lastUsed: 0,
}));

const fileNameForMime = (mimeType: string) => {
  if (mimeType.includes('wav')) return 'voice.wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'voice.mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'voice.m4a';
  if (mimeType.includes('ogg')) return 'voice.ogg';
  return 'voice.webm';
};

const responseError = async (provider: string, response: Response) => {
  const detail = (await response.text().catch(() => '')).slice(0, 240);
  console.error({ event: 'stt_error', provider, status: response.status, detail });
  const error = new Error(`${provider} failed with ${response.status}`) as Error & { status?: number };
  error.status = response.status;
  return error;
};

async function transcribeWithOpenAi(
  state: OpenAiKeyState,
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
): Promise<SttResult> {
  const form = new FormData();
  form.set('model', sttConfig.openAiModel);
  form.set('file', new Blob([bytes], { type: mimeType }), fileNameForMime(mimeType));
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: { authorization: `Bearer ${state.key}` },
    body: form,
  });
  if (!response.ok) throw await responseError(`openai_stt_${state.slot}`, response);
  const data = await response.json();
  const text = String(data?.text || '').trim();
  if (!text) throw new Error('OpenAI STT returned empty text');
  return { text, provider: 'openai', model: sttConfig.openAiModel, fallback: false };
}

async function tryOpenAiPool(bytes: Uint8Array<ArrayBuffer>, mimeType: string) {
  const attempted = new Set<number>();
  while (attempted.size < openAiKeys.length) {
    const now = Date.now();
    const state = openAiKeys
      .filter(item => !attempted.has(item.slot))
      .filter(item => item.cooldownUntil <= now)
      .filter(item => item.inFlight < sttConfig.openAiMaxConcurrencyPerKey)
      .sort((left, right) => left.inFlight - right.inFlight || left.lastUsed - right.lastUsed || left.slot - right.slot)[0];
    if (!state) return null;
    attempted.add(state.slot);
    state.inFlight += 1;
    state.lastUsed = now;
    try {
      const result = await transcribeWithOpenAi(state, bytes, mimeType);
      console.log({ event: 'stt_route', provider: 'openai', keySlot: state.slot, model: sttConfig.openAiModel });
      return result;
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 429 || (status && status >= 500)) {
        state.cooldownUntil = Date.now() + sttConfig.openAiCooldownMs;
      } else if (status && status >= 400 && status < 500) {
        return null;
      }
    } finally {
      state.inFlight = Math.max(0, state.inFlight - 1);
    }
  }
  return null;
}

async function tryDeepgram(bytes: Uint8Array<ArrayBuffer>, mimeType: string): Promise<SttResult | null> {
  if (!sttConfig.deepgramApiKey) return null;
  const model = sttConfig.deepgramModel;
  const url = 'https://api.deepgram.com/v1/listen?model=' + encodeURIComponent(model) + '&smart_format=true&detect_language=true';
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: { authorization: `Token ${sttConfig.deepgramApiKey}`, 'content-type': mimeType },
    body: bytes,
  });
  if (!response.ok) {
    await responseError('deepgram', response);
    return null;
  }
  const data = await response.json();
  const text = String(data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
  if (!text) return null;
  console.log({ event: 'stt_route', provider: 'deepgram', model });
  return { text, provider: 'deepgram', model, fallback: openAiKeys.length > 0 };
}

async function tryGroq(bytes: Uint8Array<ArrayBuffer>, mimeType: string): Promise<SttResult | null> {
  if (!sttConfig.groqApiKey) return null;
  const form = new FormData();
  form.set('model', sttConfig.groqModel);
  form.set('file', new Blob([bytes], { type: mimeType }), fileNameForMime(mimeType));
  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: { authorization: `Bearer ${sttConfig.groqApiKey}` },
    body: form,
  });
  if (!response.ok) {
    await responseError('groq', response);
    return null;
  }
  const data = await response.json();
  const text = String(data?.text || '').trim();
  if (!text) return null;
  console.log({ event: 'stt_route', provider: 'groq', model: sttConfig.groqModel });
  return { text, provider: 'groq', model: sttConfig.groqModel, fallback: openAiKeys.length > 0 || Boolean(sttConfig.deepgramApiKey) };
}

export function configuredSttProviders() {
  const now = Date.now();
  return {
    mode: sttConfig.provider,
    primary: {
      name: 'openai',
      model: sttConfig.openAiModel,
      keyCount: openAiKeys.length,
      availableKeys: openAiKeys.filter(item => item.cooldownUntil <= now && item.inFlight < sttConfig.openAiMaxConcurrencyPerKey).length,
      maxConcurrencyPerKey: sttConfig.openAiMaxConcurrencyPerKey,
    },
    fallbacks: [
      ...(sttConfig.deepgramApiKey ? [{ name: 'deepgram', model: sttConfig.deepgramModel }] : []),
      ...(sttConfig.groqApiKey ? [{ name: 'groq', model: sttConfig.groqModel }] : []),
    ],
  };
}

export async function transcribeAudio(audio: ArrayBufferLike, mimeType = 'audio/webm') {
  const source = Buffer.from(audio);
  const bytes = new Uint8Array(source.length);
  bytes.set(source);
  const mode = sttConfig.provider.toLowerCase();

  if ((mode === 'auto' || mode === 'openai') && openAiKeys.length) {
    const result = await tryOpenAiPool(bytes, mimeType);
    if (result) return result;
  }
  if (mode === 'auto' || mode === 'openai' || mode === 'deepgram') {
    const result = await tryDeepgram(bytes, mimeType);
    if (result) return result;
  }
  const groq = await tryGroq(bytes, mimeType);
  if (groq) return groq;
  return { text: '', provider: 'none', model: 'none', fallback: true } satisfies SttResult;
}
