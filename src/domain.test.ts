import { describe, expect, it } from 'vitest';
import { canBotReply, canManageConversation, canManageFaq, nextFollowup, isExpired } from './domain';

const chat = { isNew: true, whitelisted: false, botEnabled: true, status: 'bot' as const, permanent: false, lastMessageAt: '2026-11-01T00:00:00.000Z', customerReplied: false, followupsSent: 0 };

describe('eligibility', () => {
  it('answers a new contact', () => expect(canBotReply(chat)).toBe(true));
  it('answers an old whitelisted contact', () => expect(canBotReply({ ...chat, isNew: false, whitelisted: true })).toBe(true));
  it('never answers an old unlisted contact', () => expect(canBotReply({ ...chat, isNew: false })).toBe(false));
  it('OFF overrides whitelist', () => expect(canBotReply({ ...chat, botEnabled: false, whitelisted: true })).toBe(false));
  it('handover overrides whitelist', () => expect(canBotReply({ ...chat, status: 'handover', whitelisted: true })).toBe(false));
});
describe('retention and permissions', () => {
  it('limits FAQ edits to global super admin or the admin own branch', () => {
    expect(canManageFaq('super', 'b1', null)).toBe(true);
    expect(canManageFaq('admin', 'b1', 'b1')).toBe(true);
    expect(canManageFaq('admin', 'b1', 'b2')).toBe(false);
    expect(canManageFaq('admin', 'b1', null)).toBe(false);
    expect(canManageFaq('sales', 'b1', 'b1')).toBe(false);
  });
  it('allows only owner and super admin to manage chat', () => {
    expect(canManageConversation('sales', 's1', 's1')).toBe(true);
    expect(canManageConversation('sales', 's1', 's2')).toBe(false);
    expect(canManageConversation('admin', 's1', 's1')).toBe(false);
    expect(canManageConversation('super', 's1', 's2')).toBe(true);
  });
  it('expires after seven days unless permanently saved', () => {
    const now = new Date('2026-11-09T00:00:01.000Z');
    expect(isExpired(chat, now)).toBe(true);
    expect(isExpired({ ...chat, permanent: true }, now)).toBe(false);
    expect(isExpired({ ...chat, lastMessageAt: '2026-11-08T00:00:00.000Z' }, now)).toBe(false);
  });
});
describe('follow-up', () => {
  const rule = { enabled: true, count: 2, delays: [24, 72] };
  it('schedules first follow-up in 24 hours', () => expect(nextFollowup(rule, chat)).toBe(24));
  it('schedules second follow-up in 72 hours', () => expect(nextFollowup(rule, { ...chat, followupsSent: 1 })).toBe(72));
  it('stops after configured count or customer reply or handover', () => {
    expect(nextFollowup(rule, { ...chat, followupsSent: 2 })).toBe(null);
    expect(nextFollowup(rule, { ...chat, customerReplied: true })).toBe(null);
    expect(nextFollowup(rule, { ...chat, status: 'handover' })).toBe(null);
  });
  it('caps follow-ups at five even if configured higher', () => expect(nextFollowup({ enabled: true, count: 8, delays: [24, 72, 72, 72, 72, 72] }, { ...chat, followupsSent: 5 })).toBe(null));
});
