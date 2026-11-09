import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from './api';
import PilotConnection, { type PilotConnectionState } from './PilotConnection';
import PilotInbox, { type PilotConversation, type PilotMessage } from './PilotInbox';

export default function PilotWorkspace({ role, conversations, messages, selectedId, onSelect, reload }: {
  role: 'super' | 'admin' | 'sales'; conversations: PilotConversation[]; messages: PilotMessage[];
  selectedId: string | null; onSelect: (id: string) => void; reload: () => Promise<void>;
}) {
  const [connection, setConnection] = useState<PilotConnectionState>({ status: 'memeriksa', qrCode: null, verified: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const poll = async () => {
    if (role !== 'sales') return;
    try { setConnection(await apiRequest<PilotConnectionState>('/api/wa/connection')); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Tidak dapat menghubungi server.'); }
  };
  useEffect(() => {
    if (role !== 'sales') return;
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => clearInterval(timer);
  }, [role]);
  const connect = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await apiRequest('/api/wa/connect', { method: 'POST', body: { consent: true } }); await poll(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Gagal menghubungkan sesi.'); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!confirm('Putuskan perangkat tertaut dari nomor Anda?')) return;
    setBusy(true); setError('');
    try { await apiRequest('/api/wa/disconnect', { method: 'POST' }); await poll(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Gagal memutus sesi.'); }
    finally { setBusy(false); }
  };
  const send = async (text: string) => {
    setError('');
    try { await apiRequest(`/api/conversations/${selectedId}/reply`, { method: 'POST', body: { text } }); await reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Gagal mengirim balasan.'); await reload(); throw e; }
  };
  const pin = async (id: string, pinned: boolean) => {
    setError('');
    try { await apiRequest(`/api/conversations/${id}/pin`, { method: 'PATCH', body: { pinned } }); await reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Gagal mengubah retensi.'); }
  };
  return <>{error && <p className="live-error" role="alert">{error}</p>}{role === 'sales' && <PilotConnection {...connection} busy={busy} onConnect={() => void connect()} onDisconnect={() => void disconnect()}/>}<PilotInbox conversations={conversations} messages={messages} selectedId={selectedId} onSelect={onSelect} canSend={role === 'sales' && connection.verified && connection.status === 'ready'} onSend={send} onPin={role !== 'admin' ? pin : undefined}/></>;
}
