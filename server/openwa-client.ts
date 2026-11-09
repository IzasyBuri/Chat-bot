export interface GatewaySession { id: string; status: string; phone: string | null; engineLoaded: boolean }
export interface GatewayQr { qrCode: string | null; status: string }
export interface GatewaySend { messageId: string; timestamp: number }
export interface GatewayClient {
  createSession(name: string): Promise<GatewaySession>;
  startSession(id: string): Promise<void>;
  getSession(id: string): Promise<GatewaySession>;
  getQr(id: string): Promise<GatewayQr>;
  addWebhook(id: string, url: string, secret: string): Promise<{ id: string }>;
  sendText(id: string, chatId: string, text: string, idempotencyKey: string): Promise<GatewaySend>;
  logoutSession(id: string): Promise<void>;
}
export class OpenWaError extends Error {
  constructor(public readonly status: number, message = 'Gateway WhatsApp tidak tersedia.') { super(message); }
}
export class OpenWaClient implements GatewayClient {
  constructor(
    private readonly base = process.env.OPENWA_URL || 'http://127.0.0.1:2785',
    private readonly key = process.env.OPENWA_API_KEY || '',
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request<T>(method: 'GET' | 'POST', path: string, body?: object, requestId?: string): Promise<T> {
    if (!this.key) throw new OpenWaError(503, 'API key OpenWA belum dikonfigurasi.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), path.endsWith('/start') ? 45000 : 12000);
    try {
      const response = await this.fetcher(`${this.base}/api/${path}`, {
        method, signal: controller.signal,
        headers: { 'X-API-Key': this.key, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(requestId ? { 'Idempotency-Key': requestId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new OpenWaError(response.status >= 500 ? 502 : response.status);
      return await response.json() as T;
    } catch (error) { if (error instanceof OpenWaError) throw error; throw new OpenWaError(502); }
    finally { clearTimeout(timeout); }
  }
  createSession(name: string) { return this.request<GatewaySession>('POST', 'sessions', { name }); }
  async startSession(id: string) { await this.request<unknown>('POST', `sessions/${encodeURIComponent(id)}/start`); }
  getSession(id: string) { return this.request<GatewaySession>('GET', `sessions/${encodeURIComponent(id)}`); }
  getQr(id: string) { return this.request<GatewayQr>('GET', `sessions/${encodeURIComponent(id)}/qr`); }
  addWebhook(id: string, url: string, secret: string) { return this.request<{ id: string }>('POST', `sessions/${encodeURIComponent(id)}/webhooks`, { url, events: ['message.received'], secret }); }
  sendText(id: string, chatId: string, text: string, idempotencyKey: string) { return this.request<GatewaySend>('POST', `sessions/${encodeURIComponent(id)}/messages/send-text`, { chatId, text, linkPreview: false }, idempotencyKey); }
  async logoutSession(id: string) { await this.request<unknown>('POST', `sessions/${encodeURIComponent(id)}/logout`); }
}
