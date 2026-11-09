import 'dotenv/config';
import { pool } from './db';
import { buildServer } from './app';
import { reapExpiredConversations } from './retention';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi.');
if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'true') throw new Error('COOKIE_SECURE=true wajib di produksi dengan HTTPS.');
const app = await buildServer(pool);
const retentionInterval = setInterval(() => { void reapExpiredConversations(pool).catch(() => console.error('Pembersihan retensi gagal.')); }, 60 * 60 * 1000);
retentionInterval.unref();
void reapExpiredConversations(pool).catch(() => console.error('Pembersihan retensi awal gagal.'));
const port = Number(process.env.PORT || 3001);
const host = process.env.API_HOST || '127.0.0.1';
app.listen({ host, port }).then(() => console.log(`API siap di ${host}:${port}`)).catch(error => { console.error(error); process.exitCode = 1; });
