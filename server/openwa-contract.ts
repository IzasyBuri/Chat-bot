import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SECRET_MIN_LENGTH = 32;

export function normalizeGatewayPhone(value: string): string | null {
  const match = /^(\d{5,15})(?:@c\.us)?$/.exec(value);
  return match?.[1] ?? null;
}

export function verifyOpenWaSignature(raw: Buffer, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < WEBHOOK_SECRET_MIN_LENGTH || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const received = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
