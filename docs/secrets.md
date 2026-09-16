# Talqyla secrets

Do not commit real API keys or Telegram bot tokens to GitHub.

Set these as deployment/environment secrets instead:

- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_BACKUP_API_KEY`
- `OPENCODE_ZEN_API_KEY`
- `OPENCODE_ZEN_BASE_URL`
- `OPENCODE_ZEN_MODEL`
- `GOOGLE_API_KEY`
- `DEEPGRAM_API_KEY`
- `TELEGRAM_BOT_TOKEN`

Recommended default routing for free plans:

1. Groq: `llama-3.1-8b-instant` for fast opponent responses.
2. OpenRouter primary: `meta-llama/llama-3.1-8b-instruct:free`.
3. OpenRouter backup: `google/gemma-2-9b-it:free`.
4. Google: `gemini-1.5-flash` when configured.
5. Deepgram: `nova-3` for speech-to-text, fallback to Groq `whisper-large-v3-turbo`.

If a key was pasted into chat or logs, rotate it before production deployment.
