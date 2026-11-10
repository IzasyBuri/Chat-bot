import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const prodEnv = { NODE_ENV: 'production', APP_ORIGIN: 'https://pilot.example', COOKIE_SECURE: 'true', OPENWA_WEBHOOK_SECRET: 'x'.repeat(32) };

describe('runtime configuration', () => {
  it('rejects production with no explicit application origin', () => {
    expect(() => loadConfig({ ...prodEnv, APP_ORIGIN: '' })).toThrow();
  });
  it('rejects production with a non-HTTPS origin', () => {
    expect(() => loadConfig({ ...prodEnv, APP_ORIGIN: 'http://pilot.example' })).toThrow();
  });
  it('rejects production with an insecure cookie policy', () => {
    expect(() => loadConfig({ ...prodEnv, COOKIE_SECURE: 'false' })).toThrow();
  });
  it('rejects production with a webhook secret shorter than 32 characters', () => {
    expect(() => loadConfig({ ...prodEnv, OPENWA_WEBHOOK_SECRET: 'too-short' })).toThrow();
  });
  it('accepts a fully configured production environment', () => {
    const config = loadConfig(prodEnv);
    expect(config.appOrigins).toEqual(['https://pilot.example']);
    expect(config.cookieSecure).toBe(true);
    expect(config.webhookSecret).toHaveLength(32);
  });
  it('allows multiple comma-separated production origins when all are HTTPS', () => {
    const config = loadConfig({ ...prodEnv, APP_ORIGIN: 'https://a.example, https://b.example' });
    expect(config.appOrigins).toEqual(['https://a.example', 'https://b.example']);
  });
  it('defaults to the local Vite origin and insecure cookies outside production', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(config.appOrigins).toEqual(['http://localhost:5173']);
    expect(config.cookieSecure).toBe(false);
    expect(config.gatewayUrl).toBe('http://127.0.0.1:2785');
  });
  it('carries the webhook URL through for routes that need it', () => {
    expect(loadConfig({ OPENWA_WEBHOOK_URL: 'https://pilot.example/api/hooks/openwa' }).webhookUrl).toBe('https://pilot.example/api/hooks/openwa');
    expect(loadConfig({}).webhookUrl).toBe('');
  });
  it('trusts forwarding headers only for explicitly configured proxies', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: '127.0.0.1, 172.16.0.0/12' }).trustProxy).toEqual(['127.0.0.1', '172.16.0.0/12']);
  });
});
