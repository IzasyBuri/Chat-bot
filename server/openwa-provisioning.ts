import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
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

interface LinkedSession {
  sessionId: string;
  webhookId: string | null;
}

// The pilot deliberately runs a single API instance (see README). Serializing
// provisioning in-process is enough at that scale, and it avoids holding a
// pooled client across gateway HTTP calls, which used to starve /api/health
// and every other query while a QR session was being created.
const inFlight = new Map<string, Promise<unknown>>();

function serialized<T>(salesId: string, task: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(salesId);
  const current = (async () => {
    if (previous) await previous.catch(() => undefined);
    return task();
  })();
  inFlight.set(salesId, current);
  return current.finally(() => {
    if (inFlight.get(salesId) === current) inFlight.delete(salesId);
  });
}

async function transaction<T>(db: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function provisionSession(db: Pool, gateway: GatewayClient, input: ProvisionSessionInput): Promise<ProvisionSessionResult> {
  return serialized(input.salesId, async () => {
    const linked = await db.query<LinkedSession>(
      'SELECT session_id AS "sessionId", webhook_id AS "webhookId" FROM wa_sessions WHERE sales_id = $1',
      [input.salesId],
    );
    if (!linked.rowCount) return provisionNew(db, gateway, input, randomUUID(), false);

    const { sessionId, webhookId } = linked.rows[0];
    let live;
    try {
      live = await gateway.getSession(sessionId);
    } catch (error) {
      // The gateway lost the session (restored volume, manual deletion). Replace
      // only this sales account's session; conversation history follows the
      // identity update through the ON UPDATE CASCADE foreign key.
      if (!(error instanceof OpenWaError) || error.status !== 404) throw error;
      return provisionNew(db, gateway, input, randomUUID(), true);
    }
    if (live.id !== sessionId) throw new OpenWaError(502);
    if (!webhookId) {
      const webhook = await gateway.addWebhook(sessionId, input.webhookUrl, input.webhookSecret);
      if (!webhook?.id) throw new OpenWaError(502);
      await db.query('UPDATE wa_sessions SET webhook_id = $2 WHERE sales_id = $1', [input.salesId, webhook.id]);
    }
    // A logged-out or stopped engine must be restarted before the owner can scan
    // a fresh QR; otherwise "Hubungkan" reports success while nothing happens.
    if (!live.engineLoaded) await gateway.startSession(sessionId);
    return { sessionId, fresh: false };
  });
}

async function provisionNew(
  db: Pool,
  gateway: GatewayClient,
  input: ProvisionSessionInput,
  attemptId: string,
  replace: boolean,
): Promise<ProvisionSessionResult> {
  let gatewaySessionId: string | null = null;
  const sessionName = `sales-${input.salesId}`;
  try {
    await transaction(db, async client => {
      await client.query(
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
    });

    const orphan = await gateway.findSessionByName(sessionName);
    if (orphan) await gateway.deleteSession(orphan.id);
    const session = await gateway.createSession(sessionName);
    const sessionId = session.id;
    gatewaySessionId = sessionId;
    if (!UUID.test(sessionId)) throw new OpenWaError(502);
    await db.query(
      'UPDATE wa_session_provisions SET session_id = $2, updated_at = now() WHERE sales_id = $1 AND attempt_id = $3',
      [input.salesId, sessionId, attemptId],
    );
    const webhook = await gateway.addWebhook(sessionId, input.webhookUrl, input.webhookSecret);
    if (!webhook?.id) throw new OpenWaError(502);
    const live = await gateway.getSession(sessionId);
    if (!live.engineLoaded) await gateway.startSession(sessionId);

    await transaction(db, async client => {
      if (replace) {
        await client.query(
          `UPDATE wa_sessions
           SET session_id = $2, webhook_id = $3, consented_at = now(), verified_at = NULL, verified_phone = NULL
           WHERE sales_id = $1`,
          [input.salesId, sessionId, webhook.id],
        );
      } else {
        await client.query(
          'INSERT INTO wa_sessions (session_id, sales_id, consented_at, webhook_id) VALUES ($1, $2, now(), $3)',
          [sessionId, input.salesId, webhook.id],
        );
      }
      await client.query(
        `UPDATE wa_session_provisions
         SET state = 'active', session_id = $2, last_error = NULL, lease_expires_at = now(), updated_at = now()
         WHERE sales_id = $1 AND attempt_id = $3`,
        [input.salesId, sessionId, attemptId],
      );
      await client.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)', [input.salesId, 'wa_session.connect', input.salesId]);
    });
    return { sessionId, fresh: !replace };
  } catch (error) {
    if (gatewaySessionId) {
      try { await gateway.deleteSession(gatewaySessionId); }
      catch { /* Preserve the original provisioning failure. */ }
    }
    const reason = error instanceof OpenWaError ? `gateway:${error.status}` : 'provisioning_failed';
    await db.query(
      `UPDATE wa_session_provisions
       SET state = 'failed', last_error = $2, lease_expires_at = now(), updated_at = now()
       WHERE sales_id = $1 AND attempt_id = $3`,
      [input.salesId, reason, attemptId],
    ).catch(() => undefined);
    throw error;
  }
}
