import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from './auth';
import { buildServer } from './app';
import { loadConfig } from './config';
import { OpenWaError, type GatewayClient } from './openwa-client';
import { reapExpiredConversations } from './retention';
import { reapExpiredSessions } from './auth';

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL harus menunjuk database _test, bukan data aplikasi.');

describe.skipIf(!url)('PostgreSQL API integration', () => {
  const db = new pg.Pool({ connectionString: url });
  const gateway: GatewayClient = {
    createSession: vi.fn(async () => ({ id: 'd6216b2b-d4e9-4c65-93b5-c082b881a0e1', status: 'created', phone: null, engineLoaded: false })),
    startSession: vi.fn(async () => {}),
    getSession: vi.fn(async id => ({ id, status: 'qr_ready', phone: null, engineLoaded: true })),
    getQr: vi.fn(async () => ({ status: 'qr_ready', qrCode: 'data:image/png;base64,iVBORw0KGgo=' })),
    addWebhook: vi.fn(async () => ({ id: 'webhook-1' })),
    sendText: vi.fn(async () => ({ messageId: 'wa-out-1', timestamp: 1794200000 })),
    logoutSession: vi.fn(async () => {}),
    findSessionByName: vi.fn(async () => null),
    deleteSession: vi.fn(async () => {}),
  };
  let app: FastifyInstance;
  let rootCookie = '';
  let adminCookie = '';
  let b1 = '';
  let b2 = '';
  let otherSalesId = '';
  const pilotSessionId = '511cd664-06b7-4915-a7d2-59ea0c21ca01';

  beforeAll(async () => {
    process.env.OPENWA_WEBHOOK_SECRET = 'test-secret-with-at-least-16-characters';
    process.env.OPENWA_WEBHOOK_URL = 'https://example.test/api/hooks/openwa';
    app = await buildServer(db, gateway, undefined, false);
    await db.query(await readFile(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('./migrations/002_pilot_inbox.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('./migrations/003_outbound.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('./migrations/004_session_verification.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('./migrations/005_session_provisioning.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('./migrations/006_session_identity.sql', import.meta.url), 'utf8'));
    await db.query('TRUNCATE messages, conversations, wa_sessions, audit_logs, sessions, users, branches RESTART IDENTITY CASCADE');
    await db.query("INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,'Root','super')", ['root@example.com', await hashPassword('strong-password-123')]);
    await app.ready();
  });
  afterAll(async () => { await app.close(); await db.end(); });
  const request = (method: 'GET' | 'POST' | 'PATCH', path: string, cookie = '', payload?: object, headers: Record<string,string> = {}) =>
    app.inject({ method, url: path, headers: { ...(method !== 'GET' ? { origin: 'http://localhost:5173' } : {}), ...(cookie ? { cookie } : {}), ...headers }, payload });
  const pilotLogin = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.9', headers: { origin: 'http://localhost:5173' }, payload: { email, password } });
  const createSalesFixture = async (key: string, phone: string, remoteAddress: string) => {
    const branch = await db.query('INSERT INTO branches (name) VALUES ($1) RETURNING id', [`${key} Branch`]);
    const password = `strong-${key}-password`;
    const user = await db.query(
      "INSERT INTO users (name, email, password_hash, role, branch_id, phone) VALUES ($1, $2, $3, 'sales', $4, $5) RETURNING id",
      [`${key} Sales`, `${key}@example.com`, await hashPassword(password), branch.rows[0].id, phone],
    );
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, headers: { origin: 'http://localhost:5173' }, payload: { email: `${key}@example.com`, password } });
    return { salesId: user.rows[0].id as string, cookie: String(login.headers['set-cookie']).split(';')[0] };
  };

  it('rejects unauthenticated requests and uses generic login errors', async () => {
    expect((await request('GET', '/api/users')).statusCode).toBe(401);
    const bad = await request('POST', '/api/auth/login', '', { email: 'missing@example.com', password: 'wrong-password' });
    const wrong = await request('POST', '/api/auth/login', '', { email: 'root@example.com', password: 'wrong-password' });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual(wrong.json());
  });

  it('authenticates with an HttpOnly cookie and returns only safe user fields', async () => {
    const login = await request('POST', '/api/auth/login', '', { email: 'root@example.com', password: 'strong-password-123' });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    rootCookie = String(login.headers['set-cookie']).split(';')[0];
    const me = await request('GET', '/api/auth/me', rootCookie);
    expect(me.json().user).toMatchObject({ email: 'root@example.com', role: 'super' });
    expect(JSON.stringify(me.json())).not.toContain('password_hash');
  });

  it('lets super create branches and admin; admin sees only own branch', async () => {
    const one = await request('POST', '/api/branches', rootCookie, { name: 'Jakarta', location: 'Jakarta' });
    const two = await request('POST', '/api/branches', rootCookie, { name: 'Bandung', location: 'Bandung' });
    expect(one.statusCode).toBe(201); expect(two.statusCode).toBe(201);
    b1 = one.json().branch.id; b2 = two.json().branch.id;
    const admin = await request('POST', '/api/users', rootCookie, { name: 'Admin Jakarta', email: 'admin@example.com', password: 'strong-password-456', role: 'admin', branchId: b1 });
    expect(admin.statusCode).toBe(201);
    const login = await request('POST', '/api/auth/login', '', { email: 'admin@example.com', password: 'strong-password-456' });
    adminCookie = String(login.headers['set-cookie']).split(';')[0];
    const branches = await request('GET', '/api/branches', adminCookie);
    expect(branches.json().branches.map((b: { id: string }) => b.id)).toEqual([b1]);
    expect((await request('POST', '/api/branches', adminCookie, { name: 'Illegal' })).statusCode).toBe(403);
    expect((await request('PATCH', `/api/branches/${b2}`, adminCookie, { persona: 'Illegal' })).statusCode).toBe(404);
    expect((await request('POST', '/api/users', adminCookie, { name: 'Other Admin', email: 'other@example.com', password: 'strong-password-999', role: 'admin', branchId: b1 })).statusCode).toBe(403);
  });

  it('rejects cross-branch writes and does not expose cross-branch users', async () => {
    const other = await request('POST', '/api/users', rootCookie, { name: 'Sales Bandung', email: 'salesb@example.com', password: 'strong-password-777', role: 'sales', branchId: b2, phone: '628111111112' });
    otherSalesId = other.json().user.id;
    expect((await request('POST', '/api/users', adminCookie, { name: 'Wrong Branch', email: 'bad@example.com', password: 'strong-password-888', role: 'sales', branchId: b2, phone: '628111111113' })).statusCode).toBe(403);
    expect((await request('PATCH', `/api/users/${otherSalesId}`, adminCookie, { active: false })).statusCode).toBe(404);
    const list = await request('GET', '/api/users', adminCookie);
    expect(list.json().users.every((u: { branchId: string }) => u.branchId === b1)).toBe(true);
    expect(JSON.stringify(list.json())).not.toContain('salesb@example.com');
  });

  it('validates input and handles duplicate phone and email', async () => {
    expect((await request('POST', '/api/users', rootCookie, { name: '' })).statusCode).toBe(400);
    const data = { name: 'Sales One', email: 'sales1@example.com', password: 'strong-password-123', role: 'sales', branchId: b1, phone: '628111111111' };
    const created = await request('POST', '/api/users', adminCookie, data);
    expect(created.statusCode).toBe(201);
    expect((await request('POST', '/api/users', adminCookie, data)).statusCode).toBe(409);
    expect((await request('POST', '/api/users', adminCookie, { ...data, email: 'sales2@example.com' })).statusCode).toBe(409);
    const updated = await request('PATCH', `/api/users/${created.json().user.id}`, adminCookie, { name: 'Sales Updated', phone: '628111111124' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().user).toMatchObject({ name: 'Sales Updated', phone: '628111111124' });
  });

  it('rejects state changes from a foreign Origin', async () => {
    const response = await request('POST', '/api/branches', rootCookie, { name: 'Forbidden' }, { origin: 'https://attacker.example' });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a foreign Origin even when a proxy-supplied Host header matches it', async () => {
    const response = await request('POST', '/api/branches', rootCookie, { name: 'Forbidden' }, { origin: 'https://attacker.example', host: 'attacker.example' });
    expect(response.statusCode).toBe(403);
  });

  it('serves baseline security headers on success, auth-error, and health responses', async () => {
    for (const response of [await request('GET', '/api/health'), await request('GET', '/api/auth/me'), await request('GET', '/api/branches', rootCookie)]) {
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBeDefined();
    }
  });

  it('exposes administrative audit only to super admin', async () => {
    const log = await request('GET', '/api/audit', rootCookie);
    expect(log.statusCode).toBe(200);
    expect(log.json().events.some((event: { action: string }) => event.action === 'user.create')).toBe(true);
    expect((await request('GET', '/api/audit', adminCookie)).statusCode).toBe(403);
  });

  it('invalidates a disabled user session and revoked logout token', async () => {
    const login = await request('POST', '/api/auth/login', '', { email: 'sales1@example.com', password: 'strong-password-123' });
    const salesCookie = String(login.headers['set-cookie']).split(';')[0];
    expect((await request('GET', '/api/auth/me', salesCookie)).statusCode).toBe(200);
    const ownList = await request('GET', '/api/users', salesCookie);
    expect(ownList.json().users).toHaveLength(1);
    expect(ownList.json().users[0].email).toBe('sales1@example.com');
    const user = (await request('GET', '/api/users', rootCookie)).json().users.find((u: { email: string }) => u.email === 'sales1@example.com');
    expect((await request('PATCH', `/api/users/${user.id}`, adminCookie, { active: false })).statusCode).toBe(200);
    expect((await request('GET', '/api/auth/me', salesCookie)).statusCode).toBe(401);
    expect((await request('POST', '/api/auth/logout', rootCookie)).statusCode).toBe(204);
    expect((await request('GET', '/api/auth/me', rootCookie)).statusCode).toBe(401);
  });

  it('links a gateway session to exactly one sales account and enforces super-admin ownership', async () => {
    const root = await request('POST', '/api/auth/login', '', { email: 'root@example.com', password: 'strong-password-123' });
    rootCookie = String(root.headers['set-cookie']).split(';')[0];
    const sales = (await request('GET', '/api/users', rootCookie)).json().users.find((u: { email: string }) => u.email === 'salesb@example.com');
    const input = { sessionId: pilotSessionId, salesId: sales.id };
    expect((await request('POST', '/api/wa-sessions/link', adminCookie, input)).statusCode).toBe(403);
    expect((await request('POST', '/api/wa-sessions/link', rootCookie, input)).statusCode).toBe(201);
    expect((await request('POST', '/api/wa-sessions/link', rootCookie, input)).statusCode).toBe(409);
    expect((await request('GET', '/api/wa-sessions', adminCookie)).json().sessions).toEqual([]);
    expect((await request('GET', '/api/wa-sessions', rootCookie)).json().sessions[0]).toMatchObject(input);
    await db.query('UPDATE wa_sessions SET verified_at = now(), verified_phone = $2 WHERE session_id = $1', [pilotSessionId, '628111111112']);
  });

  const event = (data: object, sessionId = pilotSessionId) => JSON.stringify({ event: 'message.received', sessionId, timestamp: new Date().toISOString(), idempotencyKey: 'key', deliveryId: 'delivery', data });
  const deliver = (body: string, signed = true) => app.inject({ method: 'POST', url: '/api/hooks/openwa', headers: { 'content-type': 'application/json', ...(signed ? { 'x-openwa-signature': `sha256=${createHmac('sha256', process.env.OPENWA_WEBHOOK_SECRET!).update(Buffer.from(body)).digest('hex')}` } : {}) }, payload: body });
  const inbound = { id: 'wamid-1', from: '628199999999@c.us', chatId: '628199999999@c.us', to: '628111111112@c.us', body: 'Halo!', type: 'text', timestamp: 1794200000, fromMe: false, isGroup: false, kind: 'individual' };

  it('rejects unsigned and unknown-session deliveries without writing', async () => {
    expect((await deliver(event(inbound), false)).statusCode).toBe(401);
    expect((await deliver(event(inbound), true)).statusCode).toBe(200);
    expect((await deliver(event({ ...inbound, id: 'unknown' }, '5cf4b18e-dde1-4b51-841f-4245d0f1e662'))).statusCode).toBe(404);
  });

  it('deduplicates inbound messages and filters own, group, and non-text payloads', async () => {
    expect((await deliver(event(inbound))).statusCode).toBe(200);
    for (const data of [{ ...inbound, id: 'own', fromMe: true }, { ...inbound, id: 'group', isGroup: true }, { ...inbound, id: 'media', type: 'image', media: { data: 'secret-base64' } }]) {
      expect((await deliver(event(data))).statusCode).toBe(200);
    }
    const count = await db.query('SELECT count(*)::int AS count FROM messages');
    expect(count.rows[0].count).toBe(1);
  });

  it('accepts inbound messages when gateway omits destination phone', async () => {
    const branch = await db.query("INSERT INTO branches (name) VALUES ('Missing Destination') RETURNING id");
    const user = await db.query(
      "INSERT INTO users (name, email, password_hash, role, branch_id, phone) VALUES ('Missing Destination Sales', 'missing-destination@example.com', $1, 'sales', $2, '628166666666') RETURNING id",
      [await hashPassword('strong-missing-destination-password'), branch.rows[0].id],
    );
    const sessionId = '511cd664-06b7-4915-a7d2-59ea0c21ca03';
    await db.query('INSERT INTO wa_sessions (session_id, sales_id, verified_at, verified_phone) VALUES ($1, $2, now(), $3)', [sessionId, user.rows[0].id, '628166666666']);
    const response = await deliver(event({ ...inbound, id: 'missing-destination', to: undefined }, sessionId));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, stored: true });
    const message = await db.query('SELECT body FROM messages WHERE gateway_id = $1', ['missing-destination']);
    expect(message.rows[0].body).toBe('Halo!');
  });

  it('drops a signed message for a different destination phone and clears stale verification', async () => {
    const branch = await db.query("INSERT INTO branches (name) VALUES ('Stale Verification') RETURNING id");
    const user = await db.query(
      "INSERT INTO users (name, email, password_hash, role, branch_id, phone) VALUES ('Stale Sales', 'stale@example.com', $1, 'sales', $2, '628155555555') RETURNING id",
      [await hashPassword('strong-stale-password'), branch.rows[0].id],
    );
    const sessionId = '511cd664-06b7-4915-a7d2-59ea0c21ca02';
    await db.query(
      'INSERT INTO wa_sessions (session_id, sales_id, verified_at, verified_phone) VALUES ($1, $2, now(), $3)',
      [sessionId, user.rows[0].id, '628155555555'],
    );
    const before = await db.query('SELECT count(*)::int AS count FROM messages');

    const response = await deliver(event({ ...inbound, id: 'stale-phone', to: '628166666666@c.us' }, sessionId));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, stored: false });
    const after = await db.query('SELECT count(*)::int AS count FROM messages');
    expect(after.rows[0].count).toBe(before.rows[0].count);
    const verification = await db.query('SELECT verified_at, verified_phone FROM wa_sessions WHERE session_id = $1', [sessionId]);
    expect(verification.rows[0]).toEqual({ verified_at: null, verified_phone: null });
  });

  it('shows the conversation only within its sales branch and hides guessed IDs', async () => {
    const bandungAdmin = await request('POST', '/api/users', rootCookie, { name: 'Admin Bandung', email: 'bandung@example.com', password: 'strong-password-456', role: 'admin', branchId: b2 });
    expect(bandungAdmin.statusCode).toBe(201);
    const login = await request('POST', '/api/auth/login', '', { email: 'bandung@example.com', password: 'strong-password-456' });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const list = await request('GET', '/api/conversations', cookie);
    expect(list.json().conversations).toHaveLength(1);
    const id = list.json().conversations[0].id;
    expect((await request('GET', `/api/conversations/${id}/messages`, cookie)).json().messages[0].body).toBe('Halo!');
    expect((await request('GET', '/api/conversations', adminCookie)).json().conversations).toEqual([]);
    expect((await request('GET', `/api/conversations/${id}/messages`, adminCookie)).statusCode).toBe(404);
    expect((await request('GET', '/api/conversations', '')).statusCode).toBe(401);
  });

  it('returns the newest 200 messages in chronological display order', async () => {
    const branch = await db.query("INSERT INTO branches (name) VALUES ('Window Test') RETURNING id");
    const password = 'strong-window-password';
    const sales = await db.query(
      "INSERT INTO users (name, email, password_hash, role, branch_id, phone) VALUES ('Window Sales', 'window@example.com', $1, 'sales', $2, '628177777777') RETURNING id",
      [await hashPassword(password), branch.rows[0].id],
    );
    const sessionId = '411cd664-06b7-4915-a7d2-59ea0c21ca01';
    await db.query('INSERT INTO wa_sessions (session_id, sales_id, verified_at) VALUES ($1, $2, now())', [sessionId, sales.rows[0].id]);
    const login = await pilotLogin('window@example.com', password);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const conversation = await db.query(
      "INSERT INTO conversations (session_id, chat_id) VALUES ($1, '628188888888@c.us') RETURNING id",
      [sessionId],
    );
    await db.query(
      `INSERT INTO messages (id, conversation_id, gateway_id, body, sent_at)
       SELECT ('00000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
              $1, 'window-' || series, 'message-' || lpad(series::text, 3, '0'),
              '2026-11-10T00:00:00Z'::timestamptz
       FROM generate_series(1, 201) AS series`,
      [conversation.rows[0].id],
    );

    const response = await request('GET', `/api/conversations/${conversation.rows[0].id}/messages`, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json().messages).toHaveLength(200);
    expect(response.json().messages[0].body).toBe('message-002');
    expect(response.json().messages.at(-1).body).toBe('message-201');
  });

  it('lets a consenting sales account provision its own QR and checks the linked phone', async () => {
    const sales = await request('POST', '/api/users', adminCookie, { name: 'Pilot Jakarta', email: 'pilot@example.com', password: 'strong-password-456', role: 'sales', branchId: b1, phone: '628111111115' });
    expect(sales.statusCode).toBe(201);
    const login = await pilotLogin('pilot@example.com', 'strong-password-456');
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    expect((await request('POST', '/api/wa/connect', cookie, { consent: false })).statusCode).toBe(400);
    expect((await request('POST', '/api/wa/connect', adminCookie, { consent: true })).statusCode).toBe(403);
    // webhookUrl is resolved once from RuntimeConfig when buildServer() ran in beforeAll,
    // not re-read from process.env per request -- it stays the HTTPS value set there.
    const connected = await request('POST', '/api/wa/connect', cookie, { consent: true });
    expect(connected.statusCode).toBe(201);
    expect(gateway.addWebhook).toHaveBeenCalledWith(connected.json().sessionId, 'https://example.test/api/hooks/openwa', process.env.OPENWA_WEBHOOK_SECRET);
    const qr = await request('GET', '/api/wa/connection', cookie);
    expect(qr.json()).toMatchObject({ status: 'qr_ready', qrCode: 'data:image/png;base64,iVBORw0KGgo=', verified: false });
    vi.mocked(gateway.getSession).mockResolvedValueOnce({ id: connected.json().sessionId, status: 'ready', phone: '628000000000', engineLoaded: true });
    expect((await request('GET', '/api/wa/connection', cookie)).json()).toMatchObject({ status: 'phone_mismatch', verified: false });
    vi.mocked(gateway.getSession).mockResolvedValueOnce({ id: connected.json().sessionId, status: 'ready', phone: '628111111115', engineLoaded: true });
    expect((await request('GET', '/api/wa/connection', cookie)).json()).toMatchObject({ status: 'ready', verified: true });
    expect((await request('POST', '/api/wa/disconnect', cookie, {})).statusCode).toBe(204);
    const disconnected = await db.query('SELECT verified_at, verified_phone FROM wa_sessions WHERE sales_id = $1', [sales.json().user.id]);
    expect(disconnected.rows[0]).toEqual({ verified_at: null, verified_phone: null });
  });

  it('does not hold a database transaction while calling the gateway', async () => {
    const { cookie } = await createSalesFixture('transaction', '628111111116', '127.0.0.16');
    vi.mocked(gateway.createSession).mockImplementationOnce(async () => {
      const transactions = await db.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user AND state = 'idle in transaction'");
      expect(transactions.rows[0].count).toBe(0);
      return { id: '611cd664-06b7-4915-a7d2-59ea0c21ca01', status: 'created', phone: null, engineLoaded: false };
    });

    const response = await request('POST', '/api/wa/connect', cookie, { consent: true });
    expect(response.statusCode).toBe(201);
  });

  it('compensates a partial provisioning failure and allows a retry', async () => {
    const { salesId, cookie } = await createSalesFixture('retry', '628111111117', '127.0.0.17');
    const failedSessionId = '711cd664-06b7-4915-a7d2-59ea0c21ca01';
    vi.mocked(gateway.createSession).mockResolvedValueOnce({ id: failedSessionId, status: 'created', phone: null, engineLoaded: false });
    vi.mocked(gateway.addWebhook).mockRejectedValueOnce(new OpenWaError(502));

    expect((await request('POST', '/api/wa/connect', cookie, { consent: true })).statusCode).toBe(502);
    expect(gateway.deleteSession).toHaveBeenCalledWith(failedSessionId);
    expect((await db.query('SELECT count(*)::int AS count FROM wa_sessions WHERE sales_id = $1', [salesId])).rows[0].count).toBe(0);
    expect((await db.query('SELECT state FROM wa_session_provisions WHERE sales_id = $1', [salesId])).rows[0].state).toBe('failed');

    vi.mocked(gateway.createSession).mockResolvedValueOnce({ id: '811cd664-06b7-4915-a7d2-59ea0c21ca01', status: 'created', phone: null, engineLoaded: false });
    expect((await request('POST', '/api/wa/connect', cookie, { consent: true })).statusCode).toBe(201);
    expect((await db.query('SELECT state FROM wa_session_provisions WHERE sales_id = $1', [salesId])).rows[0].state).toBe('active');
  });

  it('deletes a gateway session that returns an invalid identifier', async () => {
    const { cookie } = await createSalesFixture('invalid-session', '628111111119', '127.0.0.19');
    vi.mocked(gateway.createSession).mockResolvedValueOnce({ id: 'invalid-id', status: 'created', phone: null, engineLoaded: false });

    expect((await request('POST', '/api/wa/connect', cookie, { consent: true })).statusCode).toBe(502);
    expect(gateway.deleteSession).toHaveBeenCalledWith('invalid-id');
  });

  it('creates one gateway session for concurrent connect requests', async () => {
    const { salesId, cookie } = await createSalesFixture('concurrent', '628111111118', '127.0.0.18');
    const callsBefore = vi.mocked(gateway.createSession).mock.calls.length;
    vi.mocked(gateway.createSession).mockResolvedValueOnce({ id: '911cd664-06b7-4915-a7d2-59ea0c21ca01', status: 'created', phone: null, engineLoaded: false });

    const responses = await Promise.all([
      request('POST', '/api/wa/connect', cookie, { consent: true }),
      request('POST', '/api/wa/connect', cookie, { consent: true }),
    ]);

    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 201]);
    expect(vi.mocked(gateway.createSession).mock.calls.length - callsBefore).toBe(1);
    expect((await db.query('SELECT count(*)::int AS count FROM wa_sessions WHERE sales_id = $1', [salesId])).rows[0].count).toBe(1);
  });

  it('restarts a logged-out gateway session when the owner reconnects', async () => {
    const { cookie } = await createSalesFixture('reconnect', '628111111120', '127.0.0.20');
    vi.mocked(gateway.createSession).mockResolvedValueOnce({ id: 'a11cd664-06b7-4915-a7d2-59ea0c21ca01', status: 'created', phone: null, engineLoaded: false });
    const first = await request('POST', '/api/wa/connect', cookie, { consent: true });
    expect(first.statusCode).toBe(201);
    const sessionId = first.json().sessionId;
    expect((await request('POST', '/api/wa/disconnect', cookie, {})).statusCode).toBe(204);

    // A logged-out session still exists at the gateway but its engine is stopped.
    vi.mocked(gateway.getSession).mockResolvedValueOnce({ id: sessionId, status: 'disconnected', phone: null, engineLoaded: false });
    const startsBefore = vi.mocked(gateway.startSession).mock.calls.length;
    const second = await request('POST', '/api/wa/connect', cookie, { consent: true });

    expect(second.statusCode).toBe(200);
    expect(second.json().sessionId).toBe(sessionId);
    expect(vi.mocked(gateway.startSession).mock.calls.length - startsBefore).toBe(1);
    expect(vi.mocked(gateway.startSession)).toHaveBeenCalledWith(sessionId);
  });

  it('replaces a gateway session that no longer exists and keeps conversation history', async () => {
    const { salesId, cookie } = await createSalesFixture('missing-session', '628111111121', '127.0.0.21');
    const oldSessionId = 'b11cd664-06b7-4915-a7d2-59ea0c21ca01';
    const newSessionId = 'b22cd664-06b7-4915-a7d2-59ea0c21ca01';
    vi.mocked(gateway.createSession).mockResolvedValueOnce({ id: oldSessionId, status: 'created', phone: null, engineLoaded: false });
    expect((await request('POST', '/api/wa/connect', cookie, { consent: true })).statusCode).toBe(201);
    await db.query("INSERT INTO conversations (session_id, chat_id) VALUES ($1, '628122222222@c.us')", [oldSessionId]);

    vi.mocked(gateway.getSession).mockRejectedValueOnce(new OpenWaError(404));
    vi.mocked(gateway.findSessionByName).mockResolvedValueOnce(null);
    vi.mocked(gateway.createSession).mockResolvedValueOnce({ id: newSessionId, status: 'created', phone: null, engineLoaded: false });
    const reconnected = await request('POST', '/api/wa/connect', cookie, { consent: true });

    expect(reconnected.statusCode).toBe(200);
    expect(reconnected.json().sessionId).toBe(newSessionId);
    expect((await db.query('SELECT session_id FROM wa_sessions WHERE sales_id = $1', [salesId])).rows[0].session_id).toBe(newSessionId);
    expect((await db.query("SELECT session_id FROM conversations WHERE chat_id = '628122222222@c.us'")).rows[0].session_id).toBe(newSessionId);
  });

  it('keeps serving health checks while provisioning waits on the gateway', async () => {
    const smallPool = new pg.Pool({ connectionString: url, max: 2 });
    const smallApp = await buildServer(smallPool, gateway, undefined, false);
    await smallApp.ready();
    let release = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    let markA = () => {};
    let markB = () => {};
    const aStarted = new Promise<void>(resolve => { markA = resolve; });
    const bStarted = new Promise<void>(resolve => { markB = resolve; });
    try {
      const a = await createSalesFixture('pool-a', '628111111122', '127.0.0.22');
      const b = await createSalesFixture('pool-b', '628111111123', '127.0.0.23');
      vi.mocked(gateway.createSession).mockImplementationOnce(async () => {
        markA();
        await wait;
        return { id: 'c11cd664-06b7-4915-a7d2-59ea0c21ca01', status: 'created', phone: null, engineLoaded: false };
      });
      vi.mocked(gateway.createSession).mockImplementationOnce(async () => {
        markB();
        await wait;
        return { id: 'd11cd664-06b7-4915-a7d2-59ea0c21ca01', status: 'created', phone: null, engineLoaded: false };
      });
      const connectA = smallApp.inject({ method: 'POST', url: '/api/wa/connect', headers: { origin: 'http://localhost:5173', cookie: a.cookie }, payload: { consent: true } });
      const connectB = smallApp.inject({ method: 'POST', url: '/api/wa/connect', headers: { origin: 'http://localhost:5173', cookie: b.cookie }, payload: { consent: true } });
      await Promise.all([aStarted, bStarted]);

      // Both gateway calls are parked. A blocked pool would stall this health
      // check until the gateway answers; the API must stay responsive.
      const health = await Promise.race([
        smallApp.inject({ method: 'GET', url: '/api/health' }).then(response => response.statusCode),
        new Promise<number>(resolve => setTimeout(() => resolve(0), 750)),
      ]);
      expect(health).toBe(200);

      release();
      await Promise.all([connectA, connectB]);
    } finally {
      release();
      await smallApp.close();
      await smallPool.end();
    }
  });

  it('keys rate limits on the forwarded client only when the proxy is trusted', async () => {
    const attempts = async (app: FastifyInstance) => {
      const results: number[] = [];
      for (let index = 0; index < 12; index++) {
        const response = await app.inject({
          method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1',
          headers: { origin: 'http://localhost:5173', 'x-forwarded-for': `203.0.113.${index}` },
          payload: { email: 'missing@example.com', password: 'incorrect' },
        });
        results.push(response.statusCode);
      }
      return results;
    };

    const trusted = await buildServer(db, gateway, loadConfig({ APP_ORIGIN: 'http://localhost:5173', TRUST_PROXY: '127.0.0.1' }), false);
    await trusted.ready();
    try { expect(await attempts(trusted)).not.toContain(429); } finally { await trusted.close(); }

    const untrusted = await buildServer(db, gateway, loadConfig({ APP_ORIGIN: 'http://localhost:5173' }), false);
    await untrusted.ready();
    try { expect(await attempts(untrusted)).toContain(429); } finally { await untrusted.close(); }
  });

  it('allows only the owner to send, records accepted (not delivered), and avoids retry on failure', async () => {
    const login = await pilotLogin('salesb@example.com', 'strong-password-777');
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const chatId = (await request('GET', '/api/conversations', cookie)).json().conversations[0].id;
    expect((await request('POST', `/api/conversations/${chatId}/reply`, adminCookie, { text: 'No' })).statusCode).toBe(403);
    vi.mocked(gateway.getSession).mockResolvedValueOnce({ id: pilotSessionId, status: 'ready', phone: '628000000000', engineLoaded: true });
    expect((await request('POST', `/api/conversations/${chatId}/reply`, cookie, { text: 'No' })).statusCode).toBe(409);
    vi.mocked(gateway.getSession).mockResolvedValueOnce({ id: pilotSessionId, status: 'ready', phone: '628111111112', engineLoaded: true });
    const reply = await request('POST', `/api/conversations/${chatId}/reply`, cookie, { text: 'Baik, kami bantu.' });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().message).toMatchObject({ direction: 'outbound', status: 'accepted' });
    expect((await request('GET', `/api/conversations/${chatId}/messages`, cookie)).json().messages.some((m: { body: string; direction: string }) => m.body === 'Baik, kami bantu.' && m.direction === 'outbound')).toBe(true);
    vi.mocked(gateway.sendText).mockRejectedValueOnce(new Error('network failure'));
    vi.mocked(gateway.getSession).mockResolvedValueOnce({ id: pilotSessionId, status: 'ready', phone: '628111111112', engineLoaded: true });
    expect((await request('POST', `/api/conversations/${chatId}/reply`, cookie, { text: 'Gagal' })).statusCode).toBe(502);
    expect((await request('GET', `/api/conversations/${chatId}/messages`, cookie)).json().messages.some((m: { body: string; status: string }) => m.body === 'Gagal' && m.status === 'unknown')).toBe(true);
  });

  it('pins chats for sales only, and reaps unpinned chats after seven days', async () => {
    const login = await pilotLogin('salesb@example.com', 'strong-password-777');
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const id = (await request('GET', '/api/conversations', cookie)).json().conversations[0].id;
    expect((await request('PATCH', `/api/conversations/${id}/pin`, adminCookie, { pinned: true })).statusCode).toBe(403);
    expect((await request('PATCH', `/api/conversations/${id}/pin`, cookie, { pinned: true })).statusCode).toBe(200);
    await db.query("UPDATE conversations SET last_message_at = now() - interval '8 days' WHERE id = $1", [id]);
    expect(await reapExpiredConversations(db)).toBe(0);
    expect((await request('GET', `/api/conversations/${id}/messages`, cookie)).statusCode).toBe(200);
    expect((await request('PATCH', `/api/conversations/${id}/pin`, cookie, { pinned: false })).statusCode).toBe(200);
    expect(await reapExpiredConversations(db)).toBe(1);
    expect((await request('GET', `/api/conversations/${id}/messages`, cookie)).statusCode).toBe(404);
  });

  it('reaps only expired sessions, leaving active ones usable', async () => {
    const login = await pilotLogin('salesb@example.com', 'strong-password-777');
    const activeCookie = String(login.headers['set-cookie']).split(';')[0];
    const activeToken = activeCookie.split('=')[1];
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (encode(sha256($1::bytea), 'hex'), (SELECT id FROM users WHERE email = 'salesb@example.com'), now() - interval '1 minute')", ['expired-token-fixture']);

    expect(await reapExpiredSessions(db)).toBe(1);

    expect((await request('GET', '/api/auth/me', activeCookie)).statusCode).toBe(200);
    expect((await db.query("SELECT 1 FROM sessions WHERE token_hash = encode(sha256('expired-token-fixture'::bytea), 'hex')")).rowCount).toBe(0);
    expect(activeToken).toBeTruthy();
  });

  it('throttles repeated login attempts from the same client', async () => {
    const results = [];
    for (let attempt = 0; attempt < 12; attempt++) results.push((await request('POST', '/api/auth/login', '', { email: 'missing@example.com', password: 'incorrect' })).statusCode);
    expect(results).toContain(429);
  });

  it('logs request outcomes without passwords, cookies, API keys, phone numbers, or message bodies', async () => {
    const lines: string[] = [];
    const logApp = await buildServer(db, gateway, undefined, { stream: { write: (line: string) => { lines.push(line); } } });
    await logApp.ready();
    await logApp.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'http://localhost:5173' }, payload: { email: 'root@example.com', password: 'wrong-but-logged-password' } });
    await logApp.inject({
      method: 'POST', url: '/api/hooks/openwa', headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'message.received', sessionId: pilotSessionId, data: { id: 'log-test', from: '628199999999@c.us', chatId: '628199999999@c.us', body: 'segredo do cliente', type: 'text', timestamp: Math.floor(Date.now() / 1000), fromMe: false, isGroup: false, kind: 'individual' } }),
    });
    await logApp.close();
    const text = lines.join('\n');
    expect(text).not.toContain('wrong-but-logged-password');
    expect(text).not.toContain('segredo do cliente');
    expect(text).not.toContain(process.env.OPENWA_WEBHOOK_SECRET);
    expect(text).not.toContain('628199999999');
    expect(text.length).toBeGreaterThan(0);
  });
});
