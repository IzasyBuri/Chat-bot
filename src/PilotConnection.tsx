export interface PilotConnectionState { status: string; qrCode: string | null; verified: boolean }

export default function PilotConnection({ status, qrCode, verified, onConnect, onDisconnect, busy = false }: PilotConnectionState & {
  onConnect: () => void; onDisconnect: () => void; busy?: boolean;
}) {
  return <section className="pilot-connection"><h2>Hubungkan WhatsApp</h2><p>Gunakan hanya nomor milik Anda. Integrasi ini tidak resmi dan bisa menyebabkan pembatasan atau pemblokiran nomor.</p><p>Status: <strong>{status === 'phone_mismatch' ? 'Nomor tidak cocok — akses pesan dinonaktifkan' : status === 'ready' && verified ? 'Terhubung dan terverifikasi' : status === 'qr_ready' ? 'Menunggu QR dipindai' : status === 'unlinked' ? 'Belum ditautkan' : status}</strong></p>{qrCode && status === 'qr_ready' && <div className="pilot-qr"><strong>Pindai QR dari Perangkat Tertaut di WhatsApp</strong><img src={qrCode} alt="QR untuk menautkan nomor WhatsApp" /></div>}{status === 'unlinked' || status === 'disconnected' || status === 'created' || status === 'failed' ? <button className="primary-btn" type="button" disabled={busy} onClick={onConnect}>Saya paham risikonya · Hubungkan nomor</button> : null}{status !== 'unlinked' && <button className="quiet-btn" type="button" disabled={busy} onClick={onDisconnect}>Putuskan sesi</button>}</section>;
}
