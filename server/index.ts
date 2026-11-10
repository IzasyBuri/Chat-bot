import 'dotenv/config';
import { pool } from './db';
import { reapExpiredSessions } from './auth';
import { buildServer } from './app';
import { loadConfig } from './config';
import { reapExpiredConversations } from './retention';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi.');
const config = loadConfig(process.env);
const app = await buildServer(pool, undefined, config);
const cleanup = async (label: string) => {
  const [conversations, sessions] = await Promise.allSettled([reapExpiredConversations(pool), reapExpiredSessions(pool)]);
  if (conversations.status === 'rejected') app.log.error({ err: conversations.reason, task: 'retention' }, `Pembersihan retensi ${label} gagal.`);
  if (sessions.status === 'rejected') app.log.error({ err: sessions.reason, task: 'sessions' }, `Pembersihan sesi ${label} gagal.`);
};
const cleanupInterval = setInterval(() => { void cleanup('berkala'); }, 60 * 60 * 1000);
cleanupInterval.unref();
void cleanup('awal');
const port = Number(process.env.PORT || 3001);
const host = process.env.API_HOST || '127.0.0.1';
app.listen({ host, port }).then(() => app.log.info(`API siap di ${host}:${port}`)).catch(error => { app.log.error(error); process.exitCode = 1; });
