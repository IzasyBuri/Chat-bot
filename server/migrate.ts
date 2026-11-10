import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pool } from './db';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi');
  const scripts = ['001_initial.sql', '002_pilot_inbox.sql', '003_outbound.sql', '004_session_verification.sql', '005_session_provisioning.sql'];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of scripts) await client.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
    await client.query('COMMIT'); console.log('Migrasi database selesai.');
  }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
