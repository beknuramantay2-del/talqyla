// Детект prompt injection. Общий для всех агентов.
//
// Это СИГНАЛ, а не защита. Regex-блэклист не остановит того, кто умеет в
// транслитерацию и перефраз, но легко отклонит нормальную фразу девятиклассника:
// «теперь ты утверждаешь обратное» — обычная реплика в дебатах.
//
// Настоящая изоляция держится на двух вещах, которые уже есть:
//   1. речь ученика обёрнута в <SPEECH>;
//   2. системный промпт велит трактовать содержимое тегов только как данные.
//
// Поэтому по умолчанию (INJECTION_ACTION=log) мы пишем факт в лог и продолжаем.

import { env } from '@talqyla/config';
import { badRequest } from './errors.js';

export interface GuardLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'en.ignore_previous', re: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i },
  { name: 'en.forget_instructions', re: /forget\s+(all\s+)?(your\s+)?(instructions|prompts|rules)/i },
  { name: 'en.system_prompt', re: /(reveal|print|show|repeat)\s+(your\s+)?(system\s+prompt|instructions)/i },
  { name: 'en.new_instructions', re: /new\s+(instructions|rules)\s*:/i },
  { name: 'en.override', re: /override\s+(your\s+)?(instructions|prompt|rules)/i },
  { name: 'ru.ignore_previous', re: /игнорир(уй|уйте|овать)\s+(все\s+)?(предыдущие|прошлые|прежние)?\s*(указания|инструкции|правила)/i },
  { name: 'ru.forget_instructions', re: /забуд(ь|ьте)\s+(все\s+)?(свои\s+)?(инструкции|указания|правила)/i },
  { name: 'ru.reveal_prompt', re: /(покажи|выведи|повтори|назови)\s+(свой\s+)?системн(ый|ые)\s+(промпт|инструкции)/i },
  { name: 'ru.role_swap', re: /(ты|вы)\s+теперь\s+(не\s+)?(оппонент|судья|система|администратор|ассистент|бот|модель)/i },
  { name: 'ru.new_rules', re: /новые\s+(инструкции|правила|указания)\s*:/i },
  { name: 'ru.exit_role', re: /выйди\s+из\s+роли/i },
  { name: 'ru.score_demand', re: /(поставь|выстави)\s+(мне\s+)?(максимальн|десят|10)/i },
];

export function detectInjection(input: string): string | null {
  for (const p of PATTERNS) if (p.re.test(input)) return p.name;
  return null;
}

/**
 * Никогда не логирует сам текст: он принадлежит несовершеннолетнему и осел бы
 * в хранилище логов навсегда.
 */
export function guardInput(
  input: string,
  ctx: { userId: string; sessionId?: string; field: string },
  log?: GuardLogger,
): void {
  const pattern = detectInjection(input);
  if (!pattern) return;

  log?.warn(
    { event: 'prompt_injection_suspected', pattern, action: env.INJECTION_ACTION, ...ctx, length: input.length },
    'Подозрение на prompt injection',
  );

  if (env.INJECTION_ACTION === 'block') {
    throw badRequest('Похоже на попытку обмануть судью. Продолжай в рамках учебных дебатов.');
  }
}
