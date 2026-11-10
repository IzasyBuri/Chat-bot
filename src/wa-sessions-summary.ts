export function summarizeWaSessions(sessions: { sessionId: string }[]): { count: number; label: string } {
  return { count: sessions.length, label: sessions.length ? 'Tertaut' : 'Belum ada' };
}
