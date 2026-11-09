import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenWaClient, OpenWaError } from './openwa-client';

afterEach(() => vi.unstubAllGlobals());
describe('OpenWA HTTP client', () => {
  it('sends API key only in header and unwraps exact QR contract', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ qrCode: 'data:image/png;base64,AA==', status: 'qr_ready' }) });
    const client = new OpenWaClient('http://127.0.0.1:2785', 'secret-key', fetcher);
    expect(await client.getQr('511cd664-06b7-4915-a7d2-59ea0c21ca01')).toEqual({ qrCode: 'data:image/png;base64,AA==', status: 'qr_ready' });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:2785/api/sessions/511cd664-06b7-4915-a7d2-59ea0c21ca01/qr', expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'secret-key' }), signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(fetcher.mock.calls[0][0])).not.toContain('secret-key');
  });
  it('sends text once with a stable idempotency key and no link preview', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: 'wa-1', timestamp: 1794200000 }) });
    const client = new OpenWaClient('http://127.0.0.1:2785', 'secret-key', fetcher);
    expect(await client.sendText('511cd664-06b7-4915-a7d2-59ea0c21ca01', '628199999999@c.us', 'Halo', 'req-1')).toEqual({ messageId: 'wa-1', timestamp: 1794200000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'X-API-Key': 'secret-key', 'Content-Type': 'application/json', 'Idempotency-Key': 'req-1' }, body: JSON.stringify({ chatId: '628199999999@c.us', text: 'Halo', linkPreview: false }) });
  });
  it('rejects missing credentials and upstream errors without exposing API key', async () => {
    const client = new OpenWaClient('http://127.0.0.1:2785', '', vi.fn());
    await expect(client.getSession('511cd664-06b7-4915-a7d2-59ea0c21ca01')).rejects.toMatchObject({ status: 503 });
    const bad = new OpenWaClient('http://127.0.0.1:2785', 'secret-key', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    await expect(bad.getSession('511cd664-06b7-4915-a7d2-59ea0c21ca01')).rejects.toBeInstanceOf(OpenWaError);
    await expect(bad.getSession('511cd664-06b7-4915-a7d2-59ea0c21ca01')).rejects.not.toThrow('secret-key');
  });
});
