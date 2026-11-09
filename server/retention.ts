import type { Pool } from 'pg';

export async function reapExpiredConversations(db: Pool): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query("DELETE FROM conversations WHERE pinned = false AND last_message_at < now() - interval '7 days' RETURNING id");
    for (const row of rows.rows) await client.query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES (NULL, $1, $2)', ['conversation.retention.delete', row.id]);
    await client.query('COMMIT');
    return rows.rowCount || 0;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
