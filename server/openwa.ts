import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Actor } from './auth';
import { OpenWaError, type GatewayClient } from './openwa-client';

const uuid = z.uuid();
const sessionLink = z.object({ sessionId: uuid, salesId: uuid }).strict();
const event = z.object({
  event: z.string(), sessionId: uuid,
  data: z.object({
    id: z.string().min(1).max(255), from: z.string(), chatId: z.string().min(5).max(255), body: z.string().max(4096),
    type: z.string(), timestamp: z.number().int().positive(), fromMe: z.boolean(), isGroup: z.boolean(), kind: z.string(),
  }).passthrough().optional(),
}).passthrough();

export function verifyOpenWaSignature(raw: Buffer, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const received = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function registerOpenWaRoutes(app: FastifyInstance, db: Pool, actor: (request: FastifyRequest, reply: FastifyReply) => Promise<Actor | null>, gateway: GatewayClient) {
  // A signed webhook is the sole cross-origin POST. Keep exact bytes for HMAC verification.
  await app.register(async hook => {
    hook.removeContentTypeParser('application/json');
    hook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    hook.post('/api/hooks/openwa', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
      const raw = request.body;
      if (!Buffer.isBuffer(raw) || !verifyOpenWaSignature(raw, request.headers['x-openwa-signature'] as string | undefined, process.env.OPENWA_WEBHOOK_SECRET)) {
        return reply.code(401).send({ error: 'Signature tidak valid.' });
      }
      let parsed: ReturnType<typeof event.safeParse>;
      try { parsed = event.safeParse(JSON.parse(raw.toString('utf8'))); }
      catch { return reply.code(400).send({ error: 'Payload tidak valid.' }); }
      if (!parsed.success) return reply.code(400).send({ error: 'Payload tidak valid.' });
      const { sessionId, data } = parsed.data;
      const mapped = await db.query("SELECT w.session_id FROM wa_sessions w JOIN users u ON u.id = w.sales_id WHERE w.session_id = $1 AND u.active AND u.role = 'sales' AND w.verified_at IS NOT NULL", [sessionId]);
      if (!mapped.rowCount) return reply.code(404).send({ error: 'Sesi tidak terdaftar.' });
      if (parsed.data.event !== 'message.received' || !data || data.fromMe || data.isGroup || data.kind !== 'individual' || data.type !== 'text' || data.from !== data.chatId || !/^\d{5,15}@c\.us$/.test(data.chatId)) return { accepted: true, stored: false };
      if (data.timestamp > Date.now() / 1000 + 3600 || data.timestamp < 946684800) return reply.code(400).send({ error: 'Waktu pesan tidak valid.' });
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const conversation = await client.query('INSERT INTO conversations (session_id, chat_id) VALUES ($1,$2) ON CONFLICT (session_id, chat_id) DO UPDATE SET chat_id = EXCLUDED.chat_id RETURNING id', [sessionId, data.chatId]);
        const inserted = await client.query('INSERT INTO messages (conversation_id, gateway_id, body, sent_at) VALUES ($1,$2,$3,to_timestamp($4)) ON CONFLICT (conversation_id, gateway_id) DO NOTHING RETURNING id', [conversation.rows[0].id, data.id, data.body, data.timestamp]);
        if (inserted.rowCount) await client.query('UPDATE conversations SET last_message_at = GREATEST(last_message_at, to_timestamp($2)) WHERE id = $1', [conversation.rows[0].id, data.timestamp]);
        await client.query('COMMIT');
        return { accepted: true, stored: !!inserted.rowCount };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    });
  });

  app.post('/api/wa/connect', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role !== 'sales') return reply.code(403).send({ error: 'Hanya pemilik nomor yang dapat menautkan sesi.' });
    if (!z.object({ consent: z.literal(true) }).strict().safeParse(request.body).success) return reply.code(400).send({ error: 'Persetujuan risiko nomor wajib diberikan.' });
    const secret = process.env.OPENWA_WEBHOOK_SECRET;
    const url = process.env.OPENWA_WEBHOOK_URL;
    if (!secret || secret.length < 32 || !url || !(url.startsWith('https://') || url === 'http://api:3001/api/hooks/openwa')) return reply.code(503).send({ error: 'Webhook OpenWA belum dikonfigurasi dengan aman.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id]);
      const existing = await client.query('SELECT session_id AS "sessionId", webhook_id AS "webhookId" FROM wa_sessions WHERE sales_id = $1', [user.id]);
      let sessionId: string;
      let fresh = false;
      if (existing.rowCount) sessionId = existing.rows[0].sessionId;
      else {
        const session = await gateway.createSession(`sales-${user.id}`);
        if (!uuid.safeParse(session.id).success) throw new OpenWaError(502);
        sessionId = session.id;
        fresh = true;
        await client.query('INSERT INTO wa_sessions (session_id, sales_id, consented_at) VALUES ($1,$2,now())', [sessionId, user.id]);
      }
      if (!existing.rows[0]?.webhookId) {
        const webhook = await gateway.addWebhook(sessionId, url, secret);
        if (!webhook?.id) throw new OpenWaError(502);
        await client.query('UPDATE wa_sessions SET webhook_id = $2 WHERE session_id = $1', [sessionId, webhook.id]);
      }
      const live = await gateway.getSession(sessionId);
      if (!live.engineLoaded) await gateway.startSession(sessionId);
      await client.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)', [user.id, 'wa_session.connect', user.id]);
      await client.query('COMMIT');
      return reply.code(fresh ? 201 : 200).send({ sessionId });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.get('/api/wa/connection', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role !== 'sales') return reply.code(403).send({ error: 'Akses ditolak.' });
    const result = await db.query('SELECT w.session_id AS "sessionId", u.phone FROM wa_sessions w JOIN users u ON u.id = w.sales_id WHERE u.id = $1', [user.id]);
    if (!result.rowCount) return { status: 'unlinked', qrCode: null, verified: false };
    const { sessionId, phone } = result.rows[0];
    const live = await gateway.getSession(sessionId);
    if (live.id !== sessionId) throw new OpenWaError(502);
    const verified = live.status === 'ready' && !!live.phone && live.phone === phone;
    await db.query('UPDATE wa_sessions SET verified_at = $2 WHERE session_id = $1', [sessionId, verified ? new Date() : null]);
    if (live.status === 'ready' && !verified) return { status: 'phone_mismatch', qrCode: null, verified: false };
    const qr = live.status === 'qr_ready' ? await gateway.getQr(sessionId) : null;
    const qrCode = qr?.qrCode && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr.qrCode) ? qr.qrCode : null;
    return { status: live.status, qrCode, verified };
  });

  app.post('/api/wa/disconnect', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role !== 'sales') return reply.code(403).send({ error: 'Akses ditolak.' });
    const row = await db.query('SELECT session_id AS "sessionId" FROM wa_sessions WHERE sales_id = $1', [user.id]);
    if (!row.rowCount) return reply.code(404).send({ error: 'Sesi tidak ditemukan.' });
    await gateway.logoutSession(row.rows[0].sessionId);
    await db.query('UPDATE wa_sessions SET verified_at = NULL WHERE sales_id = $1', [user.id]);
    await db.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)', [user.id, 'wa_session.disconnect', user.id]);
    return reply.code(204).send();
  });

  app.get('/api/wa-sessions', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    const scope = user.role === 'super' ? '' : user.role === 'admin' ? 'AND u.branch_id = $1' : 'AND u.id = $1';
    const result = await db.query(`SELECT w.session_id AS "sessionId", w.sales_id AS "salesId", u.name AS "salesName", u.branch_id AS "branchId" FROM wa_sessions w JOIN users u ON u.id = w.sales_id WHERE 1=1 ${scope} ORDER BY u.name`, user.role === 'super' ? [] : [user.role === 'admin' ? user.branchId : user.id]);
    return { sessions: result.rows };
  });
  app.post('/api/wa-sessions/link', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role !== 'super') return reply.code(403).send({ error: 'Akses ditolak.' });
    const input = sessionLink.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Data sesi tidak valid.' });
    const sales = await db.query("SELECT id FROM users WHERE id = $1 AND role = 'sales' AND active = true", [input.data.salesId]);
    if (!sales.rowCount) return reply.code(404).send({ error: 'Sales aktif tidak ditemukan.' });
    const result = await db.query('INSERT INTO wa_sessions (session_id, sales_id) VALUES ($1,$2) RETURNING session_id AS "sessionId", sales_id AS "salesId"', [input.data.sessionId, input.data.salesId]);
    await db.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)', [user.id, 'wa_session.link', input.data.salesId]);
    return reply.code(201).send({ session: result.rows[0] });
  });
  app.get('/api/conversations', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    const scope = user.role === 'super' ? '' : user.role === 'admin' ? 'AND u.branch_id = $1' : 'AND u.id = $1';
    const rows = await db.query(`SELECT c.id, c.chat_id AS "chatId", c.last_message_at AS "lastMessageAt", c.pinned, u.name AS "salesName", u.id AS "salesId", u.branch_id AS "branchId" FROM conversations c JOIN wa_sessions w ON w.session_id = c.session_id JOIN users u ON u.id = w.sales_id WHERE 1=1 ${scope} ORDER BY c.last_message_at DESC LIMIT 100`, user.role === 'super' ? [] : [user.role === 'admin' ? user.branchId : user.id]);
    return { conversations: rows.rows };
  });
  app.get('/api/conversations/:id/messages', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'Percakapan tidak ditemukan.' });
    const scope = user.role === 'super' ? '' : user.role === 'admin' ? 'AND u.branch_id = $2' : 'AND u.id = $2';
    const params = user.role === 'super' ? [id] : [id, user.role === 'admin' ? user.branchId : user.id];
    const exists = await db.query(`SELECT c.id FROM conversations c JOIN wa_sessions w ON w.session_id = c.session_id JOIN users u ON u.id = w.sales_id WHERE c.id = $1 ${scope}`, params);
    if (!exists.rowCount) return reply.code(404).send({ error: 'Percakapan tidak ditemukan.' });
    const messages = await db.query('SELECT id, body, sent_at AS "sentAt", direction, status FROM messages WHERE conversation_id = $1 ORDER BY sent_at, id LIMIT 200', [id]);
    return { messages: messages.rows };
  });
  app.patch('/api/conversations/:id/pin', async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role === 'admin') return reply.code(403).send({ error: 'Akses ditolak.' });
    const id = (request.params as { id: string }).id;
    const input = z.object({ pinned: z.boolean() }).strict().safeParse(request.body);
    if (!uuid.safeParse(id).success || !input.success) return reply.code(400).send({ error: 'Data percakapan tidak valid.' });
    const condition = user.role === 'super' ? '' : 'AND w.sales_id = $3';
    const values = user.role === 'super' ? [id, input.data.pinned] : [id, input.data.pinned, user.id];
    const rows = await db.query(`UPDATE conversations c SET pinned = $2 FROM wa_sessions w WHERE c.id = $1 AND c.session_id = w.session_id ${condition} RETURNING c.id, c.pinned`, values);
    if (!rows.rowCount) return reply.code(404).send({ error: 'Percakapan tidak ditemukan.' });
    await db.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)', [user.id, input.data.pinned ? 'conversation.pin' : 'conversation.unpin', id]);
    return { conversation: rows.rows[0] };
  });
  app.post('/api/conversations/:id/reply', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = await actor(request, reply); if (!user) return;
    if (user.role !== 'sales') return reply.code(403).send({ error: 'Hanya sales pemilik chat dapat membalas.' });
    const id = (request.params as { id: string }).id;
    const input = z.object({ text: z.string().trim().min(1).max(4096) }).strict().safeParse(request.body);
    if (!uuid.safeParse(id).success || !input.success) return reply.code(400).send({ error: 'Balasan tidak valid.' });
    const found = await db.query('SELECT c.chat_id AS "chatId", w.session_id AS "sessionId", u.phone FROM conversations c JOIN wa_sessions w ON w.session_id = c.session_id JOIN users u ON u.id = w.sales_id WHERE c.id = $1 AND u.id = $2 AND w.verified_at IS NOT NULL', [id, user.id]);
    if (!found.rowCount) return reply.code(404).send({ error: 'Percakapan tidak ditemukan atau belum diverifikasi.' });
    const { chatId, sessionId, phone } = found.rows[0];
    if (!/^\d{5,15}@c\.us$/.test(chatId)) return reply.code(400).send({ error: 'Tujuan chat tidak valid.' });
    const live = await gateway.getSession(sessionId);
    if (live.id !== sessionId || live.status !== 'ready' || live.phone !== phone) return reply.code(409).send({ error: 'Nomor terhubung tidak cocok atau belum siap.' });
    const localId = randomUUID();
    await db.query("INSERT INTO messages (conversation_id, gateway_id, body, sent_at, direction, status) VALUES ($1,$2,$3,now(),'outbound','pending')", [id, `manual:${localId}`, input.data.text]);
    try {
      const sent = await gateway.sendText(sessionId, chatId, input.data.text, localId);
      if (!sent?.messageId || !Number.isFinite(sent.timestamp)) throw new OpenWaError(502);
      const updated = await db.query("UPDATE messages SET provider_id = $1, status = 'accepted', sent_at = to_timestamp($2) WHERE gateway_id = $3 RETURNING id, body, direction, status, sent_at AS \"sentAt\"", [sent.messageId, sent.timestamp, `manual:${localId}`]);
      await db.query('UPDATE conversations SET last_message_at = GREATEST(last_message_at, now()) WHERE id = $1', [id]);
      await db.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)', [user.id, 'message.manual.accepted', id]);
      return reply.code(201).send({ message: updated.rows[0] });
    } catch {
      await db.query("UPDATE messages SET status = 'unknown' WHERE gateway_id = $1", [`manual:${localId}`]);
      await db.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)', [user.id, 'message.manual.unknown', id]);
      return reply.code(502).send({ error: 'Status pengiriman tidak diketahui. Periksa WhatsApp sebelum mengirim lagi.' });
    }
  });
}
