// Voice routes — handle speech-to-text (STT) and text-to-speech (TTS).
import { z } from 'zod';
import { env } from '@talqyla/config';
import { getAiProvider } from '../agents/provider.js';
import { badRequest, upstream } from '../lib/errors.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const TtsBody = z.object({ text: z.string().min(1, 'Текст не может быть пустым').max(env.TTS_MAX_CHARS, `Слишком длинный текст (максимум ${env.TTS_MAX_CHARS} символов)`) });
type TtsBodyType = z.infer<typeof TtsBody>;
const ALLOWED_AUDIO_MIMES = ['audio/webm','audio/mp3','audio/mpeg','audio/wav','audio/ogg','audio/x-m4a','audio/mp4'];
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;

export async function voiceRoutes(app: TypedFastifyInstance): Promise<void> {
  app.post('/voice/stt', { preHandler: app.requireAuth, config: { rateLimit: { max: 15, timeWindow: 60000 } } }, async (req, reply) => {
    const part = await req.file(); if (!part) throw badRequest('Файл аудио не прикреплен');
    if (!ALLOWED_AUDIO_MIMES.includes(part.mimetype)) throw badRequest(`Неподдерживаемый формат аудио: ${part.mimetype}. Допустимы: webm, mp3, wav, ogg, m4a`);
    const buffer = await part.toBuffer();
    if (buffer.length === 0) throw badRequest('Аудиофайл пуст');
    if (buffer.length > FILE_SIZE_LIMIT) throw badRequest('Аудиофайл слишком большой (макс. 10 МБ)');
    const result = await getAiProvider().stt.transcribe({ audio: buffer, mimeType: part.mimetype });
    req.log.info({ event: 'stt_completed', provider: result.provider, durationSec: result.durationSec }, 'STT выполнен');
    return reply.send(result);
  });

  app.post('/voice/tts', { preHandler: app.requireAuth, schema: { body: TtsBody }, config: { rateLimit: { max: 20, timeWindow: 60000 } } }, async (req, reply) => {
    if (env.TTS_PROVIDER === 'elevenlabs') throw upstream('ElevenLabs TTS пока не подключён. Выбери TTS_PROVIDER=stub или openai.');
    const { text } = req.body as TtsBodyType;
    const result = await getAiProvider().tts.synthesize({ text });
    req.log.info({ event: 'tts_completed', provider: result.provider, chars: result.chars }, 'TTS выполнен');
    reply.header('Content-Type', result.contentType);
    return reply.send(result.audio);
  });
}
