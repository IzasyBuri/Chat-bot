import 'dotenv/config';
import { pool } from './db';
import { buildServer } from './app';
import { loadConfig } from './config';
import { reapExpiredConversations } from './retention';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi.');
const config = loadConfig(process.env);
const app = await buildServer(pool, undefined, config);
const retentionInterval = setInterval(() => { void reapExpiredConversations(pool).catch(() => console.error('Pembersihan retensi gagal.')); }, 60 * 60 * 1000);
retentionInterval.unref();
void reapExpiredConversations(pool).catch(() => console.error('Pembersihan retensi awal gagal.'));
const port = Number(process.env.PORT || 3001);
const host = process.env.API_HOST || '127.0.0.1';
app.listen({ host, port }).then(() => console.log(`API siap di ${host}:${port}`)).catch(error => { console.error(error); process.exitCode = 1; });
