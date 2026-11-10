import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { GatewayClient } from './openwa-client';
import { OpenWaError } from './openwa-client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProvisionSessionInput {
  salesId: string;
  webhookUrl: string;
  webhookSecret: string;
}

export interface ProvisionSessionResult {
  sessionId: string;
  fresh: boolean;
}

export async function provisionSession(db: Pool, gateway: GatewayClient, input: ProvisionSessionInput): Promise<ProvisionSessionResult> {
  const lock = await db.connect();
  let gatewaySessionId: string | null = null;
  const attemptId = randomUUID();
  const sessionName = `sales-${input.salesId}`;
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [input.salesId]);
    const linked = await lock.query('SELECT session_id AS "sessionId" FROM wa_sessions WHERE sales_id = $1', [input.salesId]);
    if (linked.rowCount) return { sessionId: linked.rows[0].sessionId, fresh: false };

    await lock.query('BEGIN');
    try {
      await lock.query(
        `INSERT INTO wa_session_provisions (sales_id, attempt_id, state, lease_expires_at)
         VALUES ($1, $2, 'provisioning', now() + interval '5 minutes')
         ON CONFLICT (sales_id) DO UPDATE SET
           attempt_id = EXCLUDED.attempt_id,
           state = 'provisioning',
           session_id = NULL,
           last_error = NULL,
           lease_expires_at = EXCLUDED.lease_expires_at,
           updated_at = now()`,
        [input.salesId, attemptId],
      );
      await lock.query('COMMIT');
    } catch (error) {
      await lock.query('ROLLBACK');
      throw error;
    }

    const orphan = await gateway.findSessionByName(sessionName);
    if (orphan) await gateway.deleteSession(orphan.id);
    const session = await gateway.createSession(sessionName);
    gatewaySessionId = session.id;
    if (!UUID.test(session.id)) throw new OpenWaError(502);
    await lock.query(
      'UPDATE wa_session_provisions SET session_id = $2, updated_at = now() WHERE sales_id = $1 AND attempt_id = $3',
      [input.salesId, gatewaySessionId, attemptId],
    );
    const webhook = await gateway.addWebhook(gatewaySessionId, input.webhookUrl, input.webhookSecret);
    if (!webhook?.id) throw new OpenWaError(502);
    const live = await gateway.getSession(gatewaySessionId);
    if (!live.engineLoaded) await gateway.startSession(gatewaySessionId);

    await lock.query('BEGIN');
    try {
      await lock.query(
        'INSERT INTO wa_sessions (session_id, sales_id, consented_at, webhook_id) VALUES ($1, $2, now(), $3)',
        [gatewaySessionId, input.salesId, webhook.id],
      );
      await lock.query(
        `UPDATE wa_session_provisions
         SET state = 'active', session_id = $2, last_error = NULL, lease_expires_at = now(), updated_at = now()
         WHERE sales_id = $1 AND attempt_id = $3`,
        [input.salesId, gatewaySessionId, attemptId],
      );
      await lock.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)', [input.salesId, 'wa_session.connect', input.salesId]);
      await lock.query('COMMIT');
    } catch (error) {
      await lock.query('ROLLBACK');
      throw error;
    }
    return { sessionId: gatewaySessionId, fresh: true };
  } catch (error) {
    if (gatewaySessionId) {
      try { await gateway.deleteSession(gatewaySessionId); }
      catch { /* Preserve the original provisioning failure. */ }
    }
    const reason = error instanceof OpenWaError ? `gateway:${error.status}` : 'provisioning_failed';
    await lock.query(
      `UPDATE wa_session_provisions
       SET state = 'failed', last_error = $2, lease_expires_at = now(), updated_at = now()
       WHERE sales_id = $1 AND attempt_id = $3`,
      [input.salesId, reason, attemptId],
    ).catch(() => undefined);
    throw error;
  } finally {
    await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [input.salesId]).catch(() => undefined);
    lock.release();
  }
}
