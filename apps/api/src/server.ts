import { buildApp } from './app.js';
import { env } from '@talqyla/config';
import { prisma } from '@talqyla/db';
import { redis } from './lib/redis.js';
import { initSentry, closeSentry } from './lib/sentry.js';
import { purgeExpiredData } from './jobs/retention.js';
import { configureTelegramWebhook } from './routes/telegram.js';
const ONE_DAY_MS=24*60*60*1000;
async function start(){initSentry();const app=await buildApp();let retentionTimer:NodeJS.Timeout|null=null;if(env.RETENTION_JOB_ENABLED){const runPurge=async()=>{try{const result=await purgeExpiredData();app.log.info({event:'retention_purge',...result},'Retention purge completed')}catch(err){app.log.error(err,'Retention purge failed')}};void runPurge();retentionTimer=setInterval(runPurge,ONE_DAY_MS);retentionTimer.unref()}
const shutdown=async(signal:string)=>{app.log.warn(`Received ${signal}`);const timeout=setTimeout(()=>process.exit(1),10000);try{if(retentionTimer)clearInterval(retentionTimer);await app.close();await prisma.$disconnect();await redis.quit();await closeSentry();clearTimeout(timeout);process.exit(0)}catch(err){app.log.error(err);clearTimeout(timeout);process.exit(1)}};process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
try{const port=Number(process.env.PORT||env.API_PORT);await app.listen({port,host:'0.0.0.0'});app.log.info(`Talqyla API listening on 0.0.0.0:${port}`);try{await configureTelegramWebhook();if(env.TELEGRAM_BOT_TOKEN)app.log.info('Telegram webhook configured')}catch(err){app.log.error(err,'Telegram webhook setup failed')}}catch(err){app.log.error(err);process.exit(1)}}
start();
