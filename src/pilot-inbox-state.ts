import type { PilotConversation, PilotMessage } from './PilotInbox';

export const emptyPilotInbox = () => ({
  conversations: [] as PilotConversation[],
  selectedConversation: null as string | null,
  messages: [] as PilotMessage[],
});
