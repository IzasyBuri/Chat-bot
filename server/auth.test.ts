import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, hashToken, issueToken, actorCanAccessBranch, canManageUser } from './auth';

describe('auth primitives', () => {
  it('hashes passwords and rejects incorrect credentials', async () => {
    const hash = await hashPassword('testing-password-123');
    expect(hash).not.toContain('testing-password-123');
    expect(await verifyPassword(hash, 'testing-password-123')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });
  it('issues unpredictable tokens and stores only hashes', () => {
    const token = issueToken();
    expect(token.length).toBeGreaterThan(40);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toBe(token);
    expect(issueToken()).not.toBe(token);
  });
  it('does not let branch admins or sales cross branch boundaries', () => {
    expect(actorCanAccessBranch({ role: 'super', branchId: null, id: 'root' }, 'b2')).toBe(true);
    expect(actorCanAccessBranch({ role: 'admin', branchId: 'b1', id: 'a1' }, 'b1')).toBe(true);
    expect(actorCanAccessBranch({ role: 'admin', branchId: 'b1', id: 'a1' }, 'b2')).toBe(false);
    expect(actorCanAccessBranch({ role: 'sales', branchId: 'b1', id: 's1' }, 'b2')).toBe(false);
  });
  it('allows admin to manage sales in their own branch only', () => {
    const admin = { role: 'admin' as const, branchId: 'b1', id: 'a1' };
    expect(canManageUser(admin, { role: 'sales', branchId: 'b1' })).toBe(true);
    expect(canManageUser(admin, { role: 'sales', branchId: 'b2' })).toBe(false);
    expect(canManageUser(admin, { role: 'admin', branchId: 'b1' })).toBe(false);
  });
});
