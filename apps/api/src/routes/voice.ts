// Voice routes — speech-to-text and text-to-speech.
//
// Both endpoints spend real money and both used to bypass every budget: the
// only barrier was a per-minute rate limit. With a paid TTS provider that was
// roughly $14/hour from a single account just by looping the endpoint.
//
// Now: project the cost, check the daily ceiling BEFORE the call, then write
// a UsageEvent with the actual billed units.

import { z } from 'zod';
import { env } from '@talqyla/config';
import { getAiProvider } from '../agents/provider.js';
import { badRequest, upstream } from '../lib/errors.js';
import { estimateAudioSeconds, sttCostUsd, ttsCostUsd } from '../lib/pricing.js';
import { assertSttBudget, assertTtsBudget, recordUsage } from '../lib/spend.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const TtsBody = z.object({
  text: z
    .string()
    .min(1, 'Текст не может быть пустым')
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
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;

export async function voiceRoutes(app: TypedFastifyInstance): Promise<void> {
  app.post(
    '/voice/stt',
    { preHandler: app.requireAuth, config: { rateLimit: { max: 15, timeWindow: 60000 } } },
    async (req, reply) => {
      const part = await req.file();
      if (!part) throw badRequest('Файл аудио не прикреплен');
      if (!ALLOWED_AUDIO_MIMES.includes(part.mimetype)) {
        throw badRequest(`Неподдерживаемый формат аудио: ${part.mimetype}. Допустимы: webm, mp3, wav, ogg, m4a`);
      }

      const buffer = await part.toBuffer();
      if (buffer.length === 0) throw badRequest('Аудиофайл пуст');
      if (buffer.length > FILE_SIZE_LIMIT) throw badRequest('Аудиофайл слишком большой (макс. 10 МБ)');

      // Only the provider knows the real duration, but the budget has to be
      // charged BEFORE the request, so project from file size.
      const projectedSeconds = estimateAudioSeconds(buffer.length);
      const model = env.STT_PROVIDER === 'groq' ? env.GROQ_STT_MODEL : 'whisper-1';
      const projectedUsd = sttCostUsd(env.STT_PROVIDER, model, projectedSeconds);
      await assertSttBudget(req.user!.id, projectedUsd, projectedSeconds, req.log);

      const result = await getAiProvider().stt.transcribe({ audio: buffer, mimeType: part.mimetype });

      await recordUsage(
        {
          userId: req.user!.id,
          kind: 'STT',
          provider: result.provider,
          model: result.model,
          units: Math.ceil(result.durationSec),
          costUsd: result.costUsd,
        },
        req.log,
      );

      req.log.info(
        { event: 'stt_completed', provider: result.provider, durationSec: result.durationSec },
        'STT выполнен',
      );
      return reply.send({ text: result.text, durationSec: result.durationSec, provider: result.provider });
    },
  );

  app.post(
    '/voice/tts',
    {
      preHandler: app.requireAuth,
      schema: { body: TtsBody },
      config: { rateLimit: { max: 20, timeWindow: 60000 } },
    },
    async (req, reply) => {
      if (env.TTS_PROVIDER === 'elevenlabs') {
        throw upstream('ElevenLabs TTS пока не подключён. Выбери TTS_PROVIDER=stub или openai.');
      }

      const { text } = req.body as TtsBodyType;

      // Characters are known up front, so this check is exact, not estimated.
      const chars = Math.min(text.length, env.TTS_MAX_CHARS);
      const projectedUsd = ttsCostUsd(env.TTS_PROVIDER, 'tts-1', chars);
      await assertTtsBudget(req.user!.id, projectedUsd, chars, req.log);

      const result = await getAiProvider().tts.synthesize({ text });

      await recordUsage(
        {
          userId: req.user!.id,
          kind: 'TTS',
          provider: result.provider,
          model: result.model,
          units: result.chars,
          costUsd: result.costUsd,
        },
        req.log,
      );

      req.log.info({ event: 'tts_completed', provider: result.provider, chars: result.chars }, 'TTS выполнен');
      reply.header('Content-Type', result.contentType);
      return reply.send(result.audio);
    },
  );
}
