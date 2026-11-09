import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyOpenWaSignature } from './openwa';

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
});
