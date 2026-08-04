// Voice routes — STT и TTS.
//
// До v2 оба эндпоинта не попадали ни в один бюджет: единственным барьером был
// rate limit. При TTS_PROVIDER=openai это ~$14 в час с одного аккаунта. Теперь
// каждый вызов сначала проходит суточный кап, потом пишется в usage_events.
import { z } from 'zod';
import { env } from '@talqyla/config';
import { getAiProvider } from '../agents/provider.js';
import { badRequest, upstream } from '../lib/errors.js';
import { assertSttBudget, assertTtsBudget, recordUsage } from '../lib/spend.js';
import { estimateAudioSeconds, sttCostUsd, ttsCostUsd } from '../lib/pricing.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const TtsBody = z.object({
  text: z
    .string()
    .min(1, 'Текст не может быть пустым')
    .max(env.TTS_MAX_CHARS, `Слишком длинный текст (максимум ${env.TTS_MAX_CHARS} символов)`),
});
type TtsBodyType = z.infer<typeof TtsBody>;

const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a', 'audio/mp4'];
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;

function sttModel(): string {
  if (env.STT_PROVIDER === 'groq') return env.GROQ_STT_MODEL;
  if (env.STT_PROVIDER === 'openai') return 'whisper-1';
  return 'stub';
}

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

      // Списываем по верхней оценке ДО отправки: точную длительность вернёт
      // только провайдер, а деньги тратятся уже в момент запроса.
      const model = sttModel();
      const projectedSeconds = estimateAudioSeconds(buffer.length);
      const projectedUsd = sttCostUsd(env.STT_PROVIDER, model, projectedSeconds);
      await assertSttBudget(req.user!.id, projectedUsd, projectedSeconds, req.log);

      const result = await getAiProvider().stt.transcribe({ audio: buffer, mimeType: part.mimetype });

      // В ledger идёт фактическая длительность, если провайдер её вернул.
      const actualSeconds = Math.max(1, Math.round(result.durationSec || projectedSeconds));
      await recordUsage(
        {
          userId: req.user!.id,
          kind: 'STT',
          provider: result.provider,
          model,
          units: actualSeconds,
          costUsd: sttCostUsd(result.provider, model, actualSeconds),
        },
        req.log,
      );

      req.log.info({ event: 'stt_completed', provider: result.provider, durationSec: actualSeconds }, 'STT выполнен');
      return reply.send(result);
    },
  );

  app.post(
    '/voice/tts',
    { preHandler: app.requireAuth, schema: { body: TtsBody }, config: { rateLimit: { max: 20, timeWindow: 60000 } } },
    async (req, reply) => {
      if (env.TTS_PROVIDER === 'elevenlabs') {
        throw upstream('ElevenLabs TTS пока не подключён. Выбери TTS_PROVIDER=stub или openai.');
      }
      const { text } = req.body as TtsBodyType;

      // Для TTS проверка точная: символы известны до вызова.
      const model = env.TTS_PROVIDER === 'openai' ? 'tts-1' : 'stub';
      const chars = Math.min(text.length, env.TTS_MAX_CHARS);
      const projectedUsd = ttsCostUsd(env.TTS_PROVIDER, model, chars);
      await assertTtsBudget(req.user!.id, projectedUsd, chars, req.log);

      const result = await getAiProvider().tts.synthesize({ text });

      await recordUsage(
        {
          userId: req.user!.id,
          kind: 'TTS',
          provider: result.provider,
          model,
          units: result.chars,
          costUsd: ttsCostUsd(result.provider, model, result.chars),
        },
        req.log,
      );

      req.log.info({ event: 'tts_completed', provider: result.provider, chars: result.chars }, 'TTS выполнен');
      reply.header('Content-Type', result.contentType);
      return reply.send(result.audio);
    },
  );
}
