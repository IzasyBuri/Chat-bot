import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeGatewayPhone, verifyOpenWaSignature } from './openwa-contract';

const secret = 'test-secret-with-at-least-16-characters';
const raw = Buffer.from('{ "event":"message.received", "data":{} }');
const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

describe('OpenWA signature', () => {
  it('validates HMAC over exact raw bytes', () => {
    expect(verifyOpenWaSignature(raw, signature, secret)).toBe(true);
    expect(verifyOpenWaSignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), signature, secret)).toBe(false);
  });
  it('rejects malformed, absent, or incorrect signatures', () => {
    expect(verifyOpenWaSignature(raw, '', secret)).toBe(false);
    expect(verifyOpenWaSignature(raw, 'sha256=gg', secret)).toBe(false);
    expect(verifyOpenWaSignature(raw, 'sha256=' + '0'.repeat(64), secret)).toBe(false);
  });
  it('requires a webhook secret of at least 32 characters', () => {
    const shortSecret = 'sixteen-characters';
    const shortSignature = `sha256=${createHmac('sha256', shortSecret).update(raw).digest('hex')}`;
    expect(verifyOpenWaSignature(raw, shortSignature, shortSecret)).toBe(false);
    expect(verifyOpenWaSignature(raw, signature, secret)).toBe(true);
  });
});

describe('OpenWA phone normalization', () => {
  it('normalizes configured phones and individual chat JIDs', () => {
    expect(normalizeGatewayPhone('6281234567890')).toBe('6281234567890');
    expect(normalizeGatewayPhone('6281234567890@c.us')).toBe('6281234567890');
  });

  it('rejects malformed and group identifiers', () => {
    expect(normalizeGatewayPhone('120363000000000@g.us')).toBeNull();
    expect(normalizeGatewayPhone('not-a-phone')).toBeNull();
    expect(normalizeGatewayPhone('1234@c.us')).toBeNull();
  });
});
