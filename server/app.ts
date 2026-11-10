import Fastify, { type FastifyLoggerOptions, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { Pool } from 'pg';
import { actorCanAccessBranch, canManageUser, createSession, destroySession, hashPassword, lookupSession, verifyPassword, type Actor, type Role } from './auth';
import { loadConfig, type RuntimeConfig } from './config';
import { registerOpenWaRoutes } from './openwa';
import { OpenWaClient, type GatewayClient, OpenWaError } from './openwa-client';

const uuid = z.uuid();
const branchInput = z.object({ name: z.string().trim().min(1).max(120), location: z.string().trim().max(200).default('') }).strict();
const userInput = z.object({
  name: z.string().trim().min(1).max(120), email: z.email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(12).max(128), role: z.enum(['admin', 'sales']), branchId: uuid,
  phone: z.string().regex(/^\d{10,15}$/).optional(),
}).strict().refine(v => v.role === 'sales' ? !!v.phone : !v.phone, 'Nomor hanya wajib untuk sales');
const loginInput = z.object({ email: z.email().transform(v => v.trim().toLowerCase()), password: z.string().min(1) }).strict();
const userPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional(), phone: z.string().regex(/^\d{10,15}$/).optional() }).strict().refine(v => Object.keys(v).length > 0);
const branchPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), location: z.string().trim().max(200).optional(), persona: z.string().max(2000).optional() }).strict().refine(v => Object.keys(v).length > 0);
const sessionCookie = 'ruang_session';

// The default req/res serializers log only method, url, hostname, remote
// address/port, status code, and response time: no headers (so no cookies or
// API keys), and no body (so no passwords or message text).
const defaultLogger: FastifyLoggerOptions = { level: 'info' };

export async function buildServer(
  db: Pool,
  gateway: GatewayClient = new OpenWaClient(),
  config: RuntimeConfig = loadConfig(process.env),
  logger: FastifyLoggerOptions | false = defaultLogger,
) {
  const cookieOptions = { path: '/api', httpOnly: true, sameSite: 'strict' as const, secure: config.cookieSecure, maxAge: 7 * 24 * 60 * 60 };
  const app = Fastify({ logger, bodyLimit: 32 * 1024 });
  await app.register(cookie);
  await app.register(helmet, { frameguard: { action: 'deny' } });
  await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });
  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: string }).code;
    if (code === '23505') return reply.code(409).send({ error: 'Email atau nomor sudah terdaftar.' });
    if (error instanceof OpenWaError) return reply.code(error.status).send({ error: error.message });
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) return reply.code(statusCode).send({ error: statusCode === 429 ? 'Terlalu banyak percobaan. Coba lagi nanti.' : 'Permintaan tidak valid.' });
    app.log.error(error);
    return reply.code(500).send({ error: 'Layanan sedang bermasalah.' });
  });
  app.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || (request.method === 'POST' && request.url === '/api/hooks/openwa')) return;
    // Origin is compared only against the explicit allowlist: a client- or
    // proxy-supplied Host header never authorizes a write, since either can be spoofed.
    const origin = request.headers.origin;
    if (!origin || !config.appOrigins.includes(origin)) return reply.code(403).send({ error: 'Asal permintaan tidak diizinkan.' });
  });
  async function actor(request: FastifyRequest, reply: FastifyReply): Promise<Actor | null> {
    const value = request.cookies[sessionCookie];
    const user = value ? await lookupSession(db, value) : null;
    if (!user) { reply.code(401).send({ error: 'Silakan masuk kembali.' }); return null; }
    return user;
  }
  const audit = async (actorId: string, action: string, targetId: string) => { await db.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1, $2, $3)', [actorId, action, targetId]); };

  app.get('/api/health', async () => { await db.query('SELECT 1'); return { status: 'ok' }; });
  app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = loginInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Email atau password tidak valid.' });
    const found = await db.query('SELECT id, password_hash FROM users WHERE email = $1 AND active = true', [parsed.data.email]);
    // Constant work even when an email does not exist, to avoid an easy timing oracle.
    const hash = found.rows[0]?.password_hash || '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = await verifyPassword(hash, parsed.data.password).catch(() => false);
    if (!found.rows[0] || !valid) return reply.code(401).send({ error: 'Email atau password tidak valid.' });
    const token = await createSession(db, found.rows[0].id);
    reply.setCookie(sessionCookie, token, cookieOptions);
    const user = await lookupSession(db, token);
    return { user };
  });
  app.get('/api/auth/me', async (request, reply) => { const user = await actor(request, reply); if (user) return { user }; });
  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[sessionCookie];
    if (token) await destroySession(db, token);
    reply.clearCookie(sessionCookie, { path: '/api' });
    return reply.code(204).send();
  });
  app.get('/api/branches', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    const rows = user.role === 'super' ? await db.query('SELECT id, name, location, persona FROM branches ORDER BY name') : await db.query('SELECT id, name, location, persona FROM branches WHERE id = $1', [user.branchId]);
    return { branches: rows.rows };
  });
  app.post('/api/branches', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role !== 'super') return reply.code(403).send({ error: 'Akses ditolak.' });
    const input = branchInput.safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'Data cabang tidak valid.' });
    const result = await db.query('INSERT INTO branches (name, location) VALUES ($1,$2) RETURNING id, name, location, persona', [input.data.name, input.data.location]);
    await audit(user.id, 'branch.create', result.rows[0].id);
    return reply.code(201).send({ branch: result.rows[0] });
  });
  app.patch('/api/branches/:id', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    const branchId = (request.params as { id: string }).id;
    if (!uuid.safeParse(branchId).success || !actorCanAccessBranch(user, branchId)) return reply.code(404).send({ error: 'Cabang tidak ditemukan.' });
    const input = branchPatch.safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'Data cabang tidak valid.' });
    const result = await db.query('UPDATE branches SET name = COALESCE($1, name), location = COALESCE($2, location), persona = COALESCE($3, persona) WHERE id = $4 RETURNING id, name, location, persona', [input.data.name ?? null, input.data.location ?? null, input.data.persona ?? null, branchId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Cabang tidak ditemukan.' });
    await audit(user.id, 'branch.update', branchId);
    return { branch: result.rows[0] };
  });
  app.get('/api/users', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    const select = 'SELECT id, email, name, phone, role, branch_id AS "branchId", active FROM users';
    const rows = user.role === 'super' ? await db.query(`${select} ORDER BY name`) : user.role === 'admin' ? await db.query(`${select} WHERE branch_id = $1 ORDER BY name`, [user.branchId]) : await db.query(`${select} WHERE id = $1`, [user.id]);
    return { users: rows.rows };
  });
  app.get('/api/audit', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role !== 'super') return reply.code(403).send({ error: 'Akses ditolak.' });
    const rows = await db.query('SELECT id, actor_id AS "actorId", action, target_id AS "targetId", created_at AS "createdAt" FROM audit_logs ORDER BY id DESC LIMIT 100');
    return { events: rows.rows };
  });
  app.post('/api/users', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role === 'sales') return reply.code(403).send({ error: 'Akses ditolak.' });
    const input = userInput.safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'Data pengguna tidak valid.' });
    if (!canManageUser(user, input.data as { role: Role; branchId: string })) return reply.code(403).send({ error: 'Akses ditolak.' });
    const branch = await db.query('SELECT id FROM branches WHERE id = $1', [input.data.branchId]);
    if (!branch.rowCount) return reply.code(404).send({ error: 'Cabang tidak ditemukan.' });
    const passwordHash = await hashPassword(input.data.password);
    const result = await db.query('INSERT INTO users (name, email, password_hash, role, branch_id, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, phone, branch_id AS "branchId", active', [input.data.name, input.data.email, passwordHash, input.data.role, input.data.branchId, input.data.phone || null]);
    await audit(user.id, 'user.create', result.rows[0].id);
    return reply.code(201).send({ user: result.rows[0] });
  });
  app.patch('/api/users/:id', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    const targetId = (request.params as { id: string }).id;
    if (!uuid.safeParse(targetId).success) return reply.code(404).send({ error: 'Pengguna tidak ditemukan.' });
    const target = await db.query('SELECT id, role, branch_id AS "branchId" FROM users WHERE id = $1', [targetId]);
    if (!target.rowCount || !canManageUser(user, target.rows[0])) return reply.code(404).send({ error: 'Pengguna tidak ditemukan.' });
    const input = userPatch.safeParse(request.body); if (!input.success || (input.data.phone && target.rows[0].role !== 'sales')) return reply.code(400).send({ error: 'Data pengguna tidak valid.' });
    const result = await db.query('UPDATE users SET name = COALESCE($1, name), active = COALESCE($2, active), phone = COALESCE($3, phone) WHERE id = $4 RETURNING id, name, email, phone, role, branch_id AS "branchId", active', [input.data.name ?? null, input.data.active ?? null, input.data.phone ?? null, targetId]);
    await audit(user.id, 'user.update', targetId);
    return { user: result.rows[0] };
  });
  await registerOpenWaRoutes(app, db, actor, gateway);
  return app;
}
