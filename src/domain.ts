export type Role = 'super' | 'admin' | 'sales';
export type ChatStatus = 'bot' | 'off' | 'handover' | 'done';
export interface ConversationRuleState {
  isNew: boolean;
  whitelisted: boolean;
  botEnabled: boolean;
  status: ChatStatus;
  permanent: boolean;
  lastMessageAt: string;
  customerReplied: boolean;
  followupsSent: number;
}
export interface FollowupRule { enabled: boolean; count: number; delays: number[] }

export function canBotReply(chat: Pick<ConversationRuleState, 'isNew' | 'whitelisted' | 'botEnabled' | 'status'>): boolean {
  return chat.botEnabled && chat.status === 'bot' && (chat.isNew || chat.whitelisted);
}
export function canManageConversation(role: Role, ownerId: string, actorId: string): boolean {
  return role === 'super' || (role === 'sales' && ownerId === actorId);
}
export function canManageFaq(role: Role, actorBranchId: string, faqBranchId: string | null): boolean {
  return role === 'super' || (role === 'admin' && faqBranchId !== null && actorBranchId === faqBranchId);
}
export function nextFollowup(rule: FollowupRule, chat: Pick<ConversationRuleState, 'followupsSent' | 'customerReplied' | 'status'>): number | null {
  if (!rule.enabled || chat.customerReplied || chat.status === 'handover' || chat.followupsSent >= Math.min(5, Math.max(0, rule.count))) return null;
  return rule.delays[chat.followupsSent] ?? 72;
}
export function isExpired(chat: Pick<ConversationRuleState, 'permanent' | 'lastMessageAt'>, now = new Date()): boolean {
  return !chat.permanent && now.getTime() - new Date(chat.lastMessageAt).getTime() > 7 * 24 * 60 * 60 * 1000;
}
