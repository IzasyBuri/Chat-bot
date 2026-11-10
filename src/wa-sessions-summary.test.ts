import { describe, expect, it } from 'vitest';
import { summarizeWaSessions } from './wa-sessions-summary';

describe('WhatsApp session summary', () => {
  it('reports zero linked sessions distinctly from "not loaded yet"', () => {
    expect(summarizeWaSessions([])).toEqual({ count: 0, label: 'Belum ada' });
  });
  it('counts linked sessions from the actual API response', () => {
    expect(summarizeWaSessions([{ sessionId: 'a' }, { sessionId: 'b' }])).toEqual({ count: 2, label: 'Tertaut' });
  });
});
