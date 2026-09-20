# Railway variables: two OpenAI LLM keys and Groq-first STT

Set secret values in **Railway → Talqyla service → Variables**. Never commit real keys.

```dotenv
# Two keys only for thinking and answers
OPENAI_LLM_API_KEY_1=sk-proj-...
OPENAI_LLM_API_KEY_2=sk-proj-...
OPENAI_LLM_MODEL=gpt-4o-mini
LLM_MAX_CONCURRENCY_PER_PROVIDER=1
LLM_PROVIDER_COOLDOWN_MS=45000

# Primary speech-to-text
STT_PROVIDER=auto
GROQ_STT_API_KEY=gsk_...
GROQ_STT_MODEL=whisper-large-v3-turbo

# One separate OpenAI key only for STT fallback
OPENAI_STT_API_KEY=sk-proj-...
OPENAI_STT_MODEL=whisper-1
OPENAI_STT_MAX_CONCURRENCY_PER_KEY=1
OPENAI_STT_COOLDOWN_MS=60000

# Final STT fallback
DEEPGRAM_API_KEY=...
DEEPGRAM_MODEL=nova-3
```

## Routing

### Answers

1. `OPENAI_LLM_API_KEY_1` with `gpt-4o-mini`.
2. `OPENAI_LLM_API_KEY_2` with `gpt-4o-mini` when the first key is busy or cooling down.
3. Existing Groq, Google and OpenRouter providers remain optional fallbacks.

### Voice transcription

1. Groq `whisper-large-v3-turbo` — always first.
2. The isolated `OPENAI_STT_API_KEY` with OpenAI `whisper-1` — second.
3. Deepgram `nova-3` — final fallback.

The Kazakh/Russian bilingual prompt, Kazakh Cyrillic letters, debate vocabulary, no-translation rule and deterministic temperature remain enabled for Groq and OpenAI transcription.

## Migration

Remove these old Railway variables so the three OpenAI keys cannot be assigned to the wrong role:

```dotenv
OPENAI_STT_API_KEY_1
OPENAI_STT_API_KEY_2
OPENAI_STT_API_KEY_3
OPENAI_STT_MODEL=gpt-4o-transcribe
```

Then create the new role-specific variables shown above. After redeploying, `/api/providers` should report STT policy `groq_first` and route order `groq`, `openai_whisper`, `deepgram`.
