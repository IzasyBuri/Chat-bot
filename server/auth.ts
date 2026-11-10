import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Pool } from 'pg';

export type Role = 'super' | 'admin' | 'sales';
export interface Actor { id: string; role: Role; branchId: string | null; name?: string; email?: string }
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
export const issueToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const actorCanAccessBranch = (actor: Actor, branchId: string): boolean => actor.role === 'super' || actor.branchId === branchId;
export const canManageUser = (actor: Actor, target: { role: Role; branchId: string | null }): boolean =>
  actor.role === 'super' || (actor.role === 'admin' && target.role === 'sales' && !!actor.branchId && actor.branchId === target.branchId);

export async function createSession(pool: Pool, userId: string): Promise<string> {
  const token = issueToken();
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'7 days\')', [hashToken(token), userId]);
  return token;
}
export async function lookupSession(pool: Pool, token: string): Promise<Actor | null> {
  if (!token || token.length > 256) return null;
  const result = await pool.query('SELECT u.id, u.role, u.branch_id AS "branchId", u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true', [hashToken(token)]);
  return result.rows[0] || null;
}
export async function destroySession(pool: Pool, token: string): Promise<void> {
  if (!token || token.length > 256) return;
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}
export async function reapExpiredSessions(pool: Pool): Promise<number> {
  const result = await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  return result.rowCount || 0;
}
