# Railway variables: OpenAI-first voice transcription

Set these values in **Railway → Talqyla service → Variables**. Do not commit real keys.

```dotenv
STT_PROVIDER=auto
OPENAI_STT_API_KEY_1=sk-proj-...
OPENAI_STT_API_KEY_2=sk-proj-...
OPENAI_STT_API_KEY_3=sk-proj-...
OPENAI_STT_API_KEY_4=sk-proj-...
OPENAI_STT_API_KEY_5=sk-proj-...
OPENAI_STT_API_KEY_6=sk-proj-...
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_STT_MAX_CONCURRENCY_PER_KEY=1
OPENAI_STT_COOLDOWN_MS=60000
DEEPGRAM_API_KEY=...
DEEPGRAM_MODEL=nova-3
GROQ_API_KEY=...
GROQ_STT_MODEL=whisper-large-v3-turbo
```

## Effective route order

1. Any available OpenAI key using `gpt-4o-mini-transcribe`.
2. Deepgram `nova-3` only when all OpenAI slots are busy or cooling down, or OpenAI fails.
3. Groq `whisper-large-v3-turbo` only when OpenAI and Deepgram are unavailable.

With `OPENAI_STT_MAX_CONCURRENCY_PER_KEY=1`, six keys provide six concurrent OpenAI transcription slots. Increase this value only after checking account rate limits.

A key that returns 401, 403, 429, a network error, or 5xx enters cooldown. The router continues through the remaining OpenAI keys before falling back. Key values are never included in status output or logs.

After Railway redeploys, check `/api/providers`. The STT response should report:

- `routeOrder`: `openai_pool`, `deepgram`, `groq`;
- `primary.model`: `gpt-4o-mini-transcribe`;
- `primary.keyCount`: `6` when all six keys are set.

For desktop browsers, the Mini App first uses `MediaRecorder`. If Telegram Desktop or the browser does not expose microphone recording, the audio-file picker accepts WebM, MP3, MP4/M4A, WAV and OGG without forcing mobile camera/microphone capture mode.
