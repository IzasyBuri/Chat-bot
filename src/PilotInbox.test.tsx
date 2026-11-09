import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PilotInbox, { emptyPilotInbox } from './PilotInbox';
import PilotConnection from './PilotConnection';

describe('pilot inbox', () => {
  it('shows inbound messages without offering any send action', () => {
    const html = renderToStaticMarkup(<PilotInbox conversations={[{ id: '123', chatId: '628199999999@c.us', salesName: 'Sales Bandung', lastMessageAt: '2026-11-09T10:00:00Z' }]} selectedId="123" messages={[{ id: '1', body: 'Halo!', sentAt: '2026-11-09T10:00:00Z', direction: 'inbound' }]} onSelect={() => {}} />);
    expect(html).toContain('Halo!');
    expect(html).toContain('Sales Bandung');
    expect(html).toContain('Baca-saja');
    expect(html).not.toContain('Kirim');
  });
  it('clears previously viewed conversations when switching accounts', () => {
    expect(emptyPilotInbox()).toEqual({ conversations: [], selectedConversation: null, messages: [] });
  });
  it('offers send and pin actions only to the owning sales account', () => {
    const conversations = [{ id: '123', chatId: '628199999999@c.us', salesName: 'Sales Bandung', lastMessageAt: '2026-11-09T10:00:00Z', pinned: false }];
    const owner = renderToStaticMarkup(<PilotInbox conversations={conversations} selectedId="123" messages={[]} onSelect={() => {}} canSend onSend={() => {}} onPin={() => {}} />);
    expect(owner).toContain('Kirim balasan'); expect(owner).toContain('Simpan permanen');
    const admin = renderToStaticMarkup(<PilotInbox conversations={conversations} selectedId="123" messages={[]} onSelect={() => {}} />);
    expect(admin).not.toContain('Kirim balasan'); expect(admin).not.toContain('Simpan permanen');
  });
  it('renders the QR only for a session waiting to be linked', () => {
    const html = renderToStaticMarkup(<PilotConnection status="qr_ready" qrCode="data:image/png;base64,AA==" verified={false} onConnect={() => {}} onDisconnect={() => {}} />);
    expect(html).toContain('data:image/png;base64,AA==');
    expect(html).toContain('Pindai QR');
  });
});
