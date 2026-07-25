// Voice routes — handle speech-to-text (STT) and text-to-speech (TTS)
import { z } from 'zod';
import { createAiProvider, type AiProvider } from '../agents/provider.js';
import { badRequest } from '../lib/errors.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

let ai: AiProvider | null = null;
function getAi(): AiProvider {
  if (!ai) ai = createAiProvider();
  return ai;
}

const TtsBody = z.object({
  text: z.string().min(1, 'Текст не может быть пустым'),
});

type TtsBodyType = z.infer<typeof TtsBody>;

const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a', 'audio/mp4'];

const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

export async function voiceRoutes(app: TypedFastifyInstance): Promise<void> {
  // ── Speech to Text (STT) ──────────────────────────────────────────
  app.post(
    '/voice/stt',
    {
      preHandler: app.requireAuth,
    },
    async (req, reply) => {
      const part = await req.file();
      if (!part) throw badRequest('Файл аудио не прикреплен');

      if (!ALLOWED_AUDIO_MIMES.includes(part.mimetype)) {
        throw badRequest(`Неподдерживаемый формат аудио: ${part.mimetype}. Допустимы: webm, mp3, wav, ogg, m4a`);
      }

      const buffer = await part.toBuffer();
      if (buffer.length === 0) throw badRequest('Аудиофайл пуст');
      if (buffer.length > FILE_SIZE_LIMIT) throw badRequest('Аудиофайл слишком большой (макс. 10 МБ)');

      const result = await getAi().stt.transcribe({
        audio: buffer,
        mimeType: part.mimetype,
      });

      return reply.send(result);
    }
  );

  // ── Text to Speech (TTS) ──────────────────────────────────────────
  app.post(
    '/voice/tts',
    {
      preHandler: app.requireAuth,
      schema: {
        body: TtsBody,
      },
      config: { rateLimit: { max: 20, timeWindow: 60000 } }, // 20 TTS/min to limit cost
    },
    async (req, reply) => {
      const { text } = req.body as TtsBodyType;

      const result = await getAi().tts.synthesize({
        text,
      });

      reply.header('Content-Type', result.contentType);
      return reply.send(result.audio);
    }
  );
}
