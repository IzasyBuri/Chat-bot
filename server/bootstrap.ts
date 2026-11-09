import 'dotenv/config';
import { pool } from './db';
import { hashPassword } from './auth';

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!process.env.DATABASE_URL || !email || !password || password.length < 12) throw new Error('Isi DATABASE_URL, ADMIN_EMAIL dan ADMIN_PASSWORD (minimal 12 karakter) melalui environment.');
  const existing = await pool.query("SELECT id FROM users WHERE role = 'super' LIMIT 1");
  if (existing.rowCount) throw new Error('Super admin sudah ada. Bootstrap tidak mengubah akun yang ada.');
  const hash = await hashPassword(password);
  await pool.query("INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, 'Super Admin', 'super')", [email, hash]);
  console.log('Akun super admin dibuat.');
  await pool.end();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
