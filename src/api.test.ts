import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api';

afterEach(() => vi.unstubAllGlobals());
describe('API client', () => {
  it('uses same-origin cookie credentials and JSON for writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: { role: 'sales' } }) });
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/api/auth/login', { method: 'POST', body: { email: 'sales@example.com', password: 'test-password' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ credentials: 'same-origin', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sales@example.com', password: 'test-password' }) }));
  });
  it('raises a typed unauthorized error for expired sessions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Silakan masuk kembali.' }) }));
    await expect(apiRequest('/api/auth/me')).rejects.toMatchObject({ status: 401, message: 'Silakan masuk kembali.' });
  });
});
