# Railway variables: OpenAI-first voice transcription

Set these values in **Railway → Talqyla service → Variables**. Do not commit real keys.

```dotenv
STT_PROVIDER=auto
OPENAI_STT_API_KEY_1=sk-proj-...
OPENAI_STT_API_KEY_2=sk-proj-...
OPENAI_STT_API_KEY_3=sk-proj-...
OPENAI_STT_MODEL=gpt-4o-transcribe
OPENAI_STT_MAX_CONCURRENCY_PER_KEY=1
OPENAI_STT_COOLDOWN_MS=60000
DEEPGRAM_API_KEY=...
DEEPGRAM_MODEL=nova-3
GROQ_API_KEY=...
GROQ_STT_MODEL=whisper-large-v3-turbo
```

## Effective route order

1. Any available OpenAI key using `gpt-4o-transcribe`.
2. Deepgram `nova-3` only when all OpenAI slots are busy, cooling down, or OpenAI fails.
3. Groq `whisper-large-v3-turbo` only when OpenAI and Deepgram are unavailable.

OpenAI is enforced as the first route whenever at least one OpenAI key is configured. `STT_PROVIDER=auto` remains the recommended Railway value.

With `OPENAI_STT_MAX_CONCURRENCY_PER_KEY=1`, three keys provide three concurrent OpenAI transcription slots. Increase this value only after checking account rate limits.

A key that returns 401, 403, 429, a network error, or 5xx enters cooldown. The router continues through the remaining OpenAI keys before falling back. Key values are never included in status output or logs.

## Kazakh and Russian transcription

OpenAI and Groq receive a bilingual transcription prompt that:

- allows Kazakh, Russian, and code-switching in one recording;
- forbids translation and preserves the language actually spoken;
- asks for correct Kazakh Cyrillic letters: Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І;
- supplies Russian, Kazakh, and international debate terminology;
- uses deterministic temperature `0` for more stable spelling.

Deepgram keeps automatic language detection, smart formatting, and punctuation enabled.

After Railway redeploys, check `/api/providers`. The STT response should report:

- `policy`: `openai_always_first`;
- `languageMode`: `kk-ru-bilingual`;
- `routeOrder`: `openai_pool`, `deepgram`, `groq`;
- `primary.model`: `gpt-4o-transcribe`;
- `primary.keyCount`: `3` when all three keys are set.

For desktop browsers, the Mini App first uses `MediaRecorder`. If Telegram Desktop or the browser does not expose microphone recording, the audio-file picker accepts WebM, MP3, MP4/M4A, WAV and OGG without forcing mobile capture mode.
