// Voice routes — handle speech-to-text (STT) and text-to-speech (TTS).
//
// COST NOTE: both endpoints spend real money per call and are reachable by any
// authenticated 14-year-old (or a script holding their token). Every knob here
// is a spend control, not a nicety.
import { z } from 'zod';
import { env } from '@talqyla/config';
import { getAiProvider } from '../agents/provider.js';
import { badRequest } from '../lib/errors.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const TtsBody = z.object({
  text: z
    .string()
    .min(1, 'Текст не может быть пустым')
    // TTS is billed per character. Without a ceiling this endpoint is a free
    // text-to-speech API for the entire internet, paid for by us.
    .max(env.TTS_MAX_CHARS, `Слишком длинный текст (максимум ${env.TTS_MAX_CHARS} символов)`),
});

type TtsBodyType = z.infer<typeof TtsBody>;

const ALLOWED_AUDIO_MIMES = [
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/x-m4a',
  'audio/mp4',
];

const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

export async function voiceRoutes(app: TypedFastifyInstance): Promise<void> {
  // ── Speech to Text (STT) ──────────────────────────────────────────
  app.post(
    '/voice/stt',
    {
      preHandler: app.requireAuth,
      // Global rate limiting is off (app.ts sets `global: false`), so without
      // this an authenticated client could push 10 MB of audio in a loop.
      config: { rateLimit: { max: 15, timeWindow: 60000 } },
    },
    async (req, reply) => {
      const part = await req.file();
      if (!part) throw badRequest('Файл аудио не прикреплен');

      if (!ALLOWED_AUDIO_MIMES.includes(part.mimetype)) {
        throw badRequest(
          `Неподдерживаемый формат аудио: ${part.mimetype}. Допустимы: webm, mp3, wav, ogg, m4a`,
        );
      }

      const buffer = await part.toBuffer();
      if (buffer.length === 0) throw badRequest('Аудиофайл пуст');
      if (buffer.length > FILE_SIZE_LIMIT) throw badRequest('Аудиофайл слишком большой (макс. 10 МБ)');

      const result = await getAiProvider().stt.transcribe({
        audio: buffer,
        mimeType: part.mimetype,
      });

      req.log.info(
        { event: 'stt_completed', provider: result.provider, durationSec: result.durationSec },
        'STT выполнен',
      );

      return reply.send(result);
    },
  );

  // ── Text to Speech (TTS) ──────────────────────────────────────────
  app.post(
    '/voice/tts',
    {
      preHandler: app.requireAuth,
      schema: { body: TtsBody },
      config: { rateLimit: { max: 20, timeWindow: 60000 } }, // 20 TTS/min to limit cost
    },
    async (req, reply) => {
      const { text } = req.body as TtsBodyType;

      const result = await getAiProvider().tts.synthesize({ text });

      req.log.info({ event: 'tts_completed', provider: result.provider, chars: result.chars }, 'TTS выполнен');

      reply.header('Content-Type', result.contentType);
      return reply.send(result.audio);
    },
  );
}
