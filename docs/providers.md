# Provider routing

Do not commit real keys.

Verified defaults as of 2026-09-16 from official docs:

## Google Gemini API

Source: https://ai.google.dev/gemini-api/docs/models

Use for Talqyla:

- Judge / Coach: `gemini-3.8-flash`
- Cheap fallback: `gemini-3.5-flash` or `gemini-2.5-flash-lite`
- Speech-to-text: `gemini-3.5-transcribe`

Do not use `gemini-1.5-flash`. Gemini 2.0 Flash is marked shutdown.

## Groq STT

Source: https://console.groq.com/docs/speech-to-text

- `whisper-large-v3-turbo` (default, faster/cheaper)
- `whisper-large-v3` (more accurate, supports translation)

## Deepgram

Source: https://deepgram.com/pricing

- `nova-3` default
- `nova-2` fallback
- Pay as you go start credit is advertised with no credit card required. Confirm current credit amount in the console; marketing pages often say $200.

## AssemblyAI

- https://www.assemblyai.com/pricing
- https://www.assemblyai.com/dashboard/signup

Free start with no credit card is advertised. Exact credit amount can change.

## Speechmatics

- https://www.speechmatics.com/pricing
- Start credit advertised as $100, no card required. Confirm in portal.

## Not for Talqyla API core

TurboScribe, Riverside, SaluteSpeech Bot, Teamlogs, Speech2Text.ru are user-facing tools, not the primary backend STT path.
