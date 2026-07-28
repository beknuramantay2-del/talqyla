// CLI entry for the retention purge: `pnpm retention:purge`.
// Use this from cron when running more than one API instance.
import { prisma } from '@talqyla/db';
import { purgeExpiredData } from './retention.js';

try {
  const result = await purgeExpiredData();
  console.log('Очистка по политике хранения завершена:');
  console.log(`  граница:            ${result.cutoff.toISOString()}`);
  console.log(`  реплик обезличено:  ${result.turnsRedacted}`);
  console.log(`  раундов обезличено: ${result.roundsRedacted}`);
  console.log(`  фидбека обезличено: ${result.feedbackRedacted}`);
  console.log(`  токенов удалено:    ${result.refreshTokensDeleted}`);
} catch (err) {
  console.error('Очистка упала:', err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
