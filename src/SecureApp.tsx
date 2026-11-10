import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, CircleHelp, LayoutDashboard, LogOut, MessageCircle, Plus, ShieldCheck, Users, WifiOff, X } from 'lucide-react';
import { ApiError, apiRequest } from './api';
import type { PilotConversation, PilotMessage } from './PilotInbox';
import { emptyPilotInbox } from './pilot-inbox-state';
import PilotWorkspace from './PilotWorkspace';
import { summarizeWaSessions } from './wa-sessions-summary';

type Role = 'super' | 'admin' | 'sales';
type Page = 'Ringkasan' | 'Inbox' | 'Tim sales' | 'Cabang';
interface User { id: string; name: string; email: string; role: Role; branchId: string | null; phone: string | null; active: boolean }
interface Branch { id: string; name: string; location: string; persona: string }
const labels: Record<Role, string> = { super: 'Super admin', admin: 'Admin cabang', sales: 'Sales' };

export default function SecureApp() {
  const [user, setUser] = useState<User | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [page, setPage] = useState<Page>('Ringkasan');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [form, setForm] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<'branch' | 'user' | null>(null);
  const [conversations, setConversations] = useState<PilotConversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<PilotMessage[]>([]);
  const [waSessions, setWaSessions] = useState<{ sessionId: string }[] | null>(null);
  const clearInbox = () => { const empty = emptyPilotInbox(); setConversations(empty.conversations); setSelectedConversation(empty.selectedConversation); setMessages(empty.messages); };
  const reloadInbox = useCallback(async () => {
    const list = await apiRequest<{ conversations: PilotConversation[] }>('/api/conversations');
    setConversations(list.conversations);
    if (selectedConversation) {
      const history = await apiRequest<{ messages: PilotMessage[] }>(`/api/conversations/${selectedConversation}/messages`);
      setMessages(history.messages);
    }
  }, [selectedConversation]);
  useEffect(() => {
    if (!user || page !== 'Inbox') return;
    const initial = setTimeout(() => void reloadInbox().catch(() => setError('Inbox tidak dapat dimuat.')), 0);
    const timer = setInterval(() => void reloadInbox().catch(() => setError('Inbox tidak dapat dimuat.')), 4000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [user, page, reloadInbox]);

  const refresh = useCallback(async () => {
    const [b, u, w] = await Promise.all([
      apiRequest<{ branches: Branch[] }>('/api/branches'),
      apiRequest<{ users: User[] }>('/api/users'),
      apiRequest<{ sessions: { sessionId: string }[] }>('/api/wa-sessions').catch(() => null),
    ]);
    setBranches(b.branches); setPeople(u.users); setWaSessions(w?.sessions ?? null);
  }, []);
  useEffect(() => {
    apiRequest<{ user: User }>('/api/auth/me').then(async response => { setUser(response.user); await refresh(); })
      .catch(e => { if (!(e instanceof ApiError && e.status === 401)) setError('API tidak dapat dijangkau. Jalankan server dan coba lagi.'); })
      .finally(() => setLoading(false));
  }, [refresh]);
  const login = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const response = await apiRequest<{ user: User }>('/api/auth/login', { method: 'POST', body: loginForm }); clearInbox(); setUser(response.user); setLoginForm({ email: '', password: '' }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Server tidak dapat dijangkau.'); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true); setError('');
    try { await apiRequest('/api/auth/logout', { method: 'POST' }); clearInbox(); setUser(null); setPeople([]); setBranches([]); setWaSessions(null); setPage('Ringkasan'); }
    catch { setError('Gagal keluar. Coba lagi.'); }
    finally { setBusy(false); }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (adding === 'branch') await apiRequest('/api/branches', { method: 'POST', body: { name: form.name, location: form.location || '' } });
      if (adding === 'user') await apiRequest('/api/users', { method: 'POST', body: { name: form.name, email: form.email, password: form.password, role: form.role, branchId: form.branchId, ...(form.role === 'sales' ? { phone: form.phone } : {}) } });
      await refresh(); setAdding(null); setForm({});
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Server tidak dapat dijangkau.'); }
    finally { setBusy(false); }
  };
  const toggleUser = async (target: User) => {
    if (!confirm(`${target.active ? 'Nonaktifkan' : 'Aktifkan'} akun ${target.name}?`)) return;
    setBusy(true); setError('');
    try { await apiRequest(`/api/users/${target.id}`, { method: 'PATCH', body: { active: !target.active } }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Gagal memperbarui akun.'); }
    finally { setBusy(false); }
  };
  const savePersona = async (branch: Branch, persona: string) => {
    setBusy(true); setError('');
    try { await apiRequest(`/api/branches/${branch.id}`, { method: 'PATCH', body: { persona } }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Gagal menyimpan persona.'); }
    finally { setBusy(false); }
  };

  if (loading) return <main className="live-loading" role="status">Memeriksa sesi…</main>;
  if (!user) return <main className="login-screen"><div className="login-layout"><div className="login-story"><div className="live-brand"><span className="brand-mark"><MessageCircle size={22}/></span><strong>ruang<span>sales</span></strong></div><h1>Setiap percakapan ada pemiliknya.</h1><p>Masuk untuk mengelola cabang dan tim sales dengan akses sesuai peran Anda.</p><div className="login-note"><ShieldCheck size={19}/> Data akun tersimpan di server, bukan di browser.</div></div><form className="login-form" onSubmit={login}><div className="login-form-head"><h2>Masuk ke ruang kerja</h2><p>Gunakan akun yang dibuat oleh administrator.</p></div><label>Email<input required type="email" name="email" autoComplete="username" value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="nama@perusahaan.com"/></label><label>Password<input required type="password" name="password" autoComplete="current-password" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} placeholder="Masukkan password"/></label>{error && <p className="form-error" role="alert">{error} <button type="button" onClick={() => { setError(''); setLoading(true); apiRequest('/api/health').then(() => setError('')).catch(() => setError('API tidak dapat dijangkau.')).finally(() => setLoading(false)); }}>Coba lagi</button></p>}<button className="primary-btn login-submit" type="submit" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk'}</button><p className="login-footnote">Belum punya akun? Hubungi super admin.</p></form></div></main>;

  const menu: { name: Page; icon: typeof Users }[] = [ { name: 'Ringkasan', icon: LayoutDashboard }, { name: 'Inbox', icon: MessageCircle }, { name: 'Tim sales', icon: Users }, { name: 'Cabang', icon: Building2 } ];
  return <div className="app-shell live-shell"><aside className="sidebar live-sidebar"><div className="brand"><div className="brand-mark"><MessageCircle size={22}/></div><div><strong>ruang<span>sales</span></strong><small>Ruang kerja langsung</small></div></div><div className="workspace"><span className="workspace-icon">R</span><span><strong>Ruang Sales</strong><small>{labels[user.role]}</small></span></div><nav aria-label="Navigasi utama"><p className="nav-caption">Kelola</p>{menu.filter(item => user.role !== 'sales' || item.name !== 'Cabang').map(({ name, icon: Icon }) => <button className={`nav-item ${page === name ? 'active' : ''}`} type="button" key={name} onClick={() => { setPage(name); setError(''); }}><Icon size={18}/>{name}</button>)}</nav><div className="sidebar-bottom"><div className="connection"><WifiOff size={18}/><div><strong>{waSessions === null ? 'Status WhatsApp belum dimuat' : waSessions.length ? `${waSessions.length} nomor WhatsApp tertaut` : 'Belum ada nomor WhatsApp tertaut'}</strong><span>Lihat tab Inbox untuk status sambungan</span></div></div><div className="sidebar-profile"><span className="avatar profile-avatar">{user.name.slice(0,1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{labels[user.role]}</small></span></div><button type="button" className="logout-button" onClick={logout} disabled={busy}><LogOut size={17}/> Keluar</button></div></aside><main className="main-area"><header className="topbar"><span className="breadcrumb">Ruang Sales <span>/</span> <strong>{page}</strong></span><span className="demo-pill">Backend aktif</span></header><div className="page-body live-content"><div className="page-head"><div><h1>{page === 'Ringkasan' ? `Halo, ${user.name}` : page}</h1><p>{page === 'Ringkasan' ? 'Fondasi akun dan cabang sudah terhubung ke server.' : page === 'Tim sales' ? 'Akun di bawah cakupan akses Anda.' : 'Cabang yang dapat Anda kelola.'}</p></div></div>{error && <div className="live-error" role="alert">{error}<button type="button" aria-label="Tutup pesan" onClick={() => setError('')}><X size={16}/></button></div>}
  {page === 'Ringkasan' && <><div className="summary-banner"><div className="banner-icon"><ShieldCheck size={22}/></div><div><strong>Data kerja tersimpan di PostgreSQL</strong><p>Login, peran, cabang, tim sales, dan inbox WhatsApp manual sudah menggunakan API. Balasan AI otomatis belum tersedia.</p></div></div><section className="stat-grid"><div className="stat"><span>Cabang terlihat</span><strong>{branches.length}</strong><small>Sesuai izin akun</small></div><div className="stat"><span>Anggota terlihat</span><strong>{people.length}</strong><small>Sesuai izin akun</small></div><div className="stat"><span>Sales aktif</span><strong>{people.filter(p => p.role === 'sales' && p.active).length}</strong><small>Dalam cakupan Anda</small></div><div className="stat"><span>Sesi WhatsApp</span><strong>{waSessions === null ? '—' : summarizeWaSessions(waSessions).count}</strong><small>{waSessions === null ? 'Belum dimuat' : summarizeWaSessions(waSessions).label}</small></div></section><div className="info-strip"><CircleHelp size={18}/><p>FAQ, follow-up otomatis, dan balasan AI belum tersedia di ruang kerja ini. Buka tab Inbox untuk menautkan dan membalas WhatsApp secara manual.</p></div></>}
  {page === 'Tim sales' && <section className="content-section"><div className="section-heading"><div><h2>Daftar akun</h2><p>Sales terikat pada tepat satu cabang.</p></div>{user.role !== 'sales' && <button className="primary-btn" type="button" onClick={() => { setForm({ role: 'sales', branchId: branches[0]?.id || '' }); setAdding('user'); }}><Plus size={16}/> Tambah akun</button>}</div><div className="live-table"><div className="live-table-head"><span>Nama</span><span>Peran</span><span>Cabang</span><span>Status</span></div>{people.map(person => <div className="live-table-row" key={person.id}><div><strong>{person.name}</strong><small>{person.email}{person.phone ? ` · +${person.phone}` : ''}</small></div><span>{labels[person.role]}</span><span>{branches.find(b => b.id === person.branchId)?.name || 'Semua cabang'}</span><span>{user.role !== 'sales' && person.role !== 'super' && (user.role === 'super' || person.role === 'sales') ? <button className={`state-toggle ${person.active ? 'on' : ''}`} type="button" disabled={busy} onClick={() => toggleUser(person)}>{person.active ? 'Aktif' : 'Nonaktif'}</button> : <span className="scope-tag">{person.active ? 'Aktif' : 'Nonaktif'}</span>}</span></div>)}{people.length === 0 && <div className="empty-state"><Users size={24}/><strong>Belum ada anggota</strong><p>Tambahkan akun agar tim dapat masuk.</p></div>}</div></section>}
  {page === 'Cabang' && <section className="content-section"><div className="section-heading"><div><h2>Daftar cabang</h2><p>Admin cabang hanya melihat dan mengelola cabangnya.</p></div>{user.role === 'super' && <button className="primary-btn" type="button" onClick={() => { setForm({}); setAdding('branch'); }}><Plus size={16}/> Tambah cabang</button>}</div><div className="branch-grid">{branches.map(branch => <div className="branch-item" key={branch.id}><span className="branch-letter">{branch.name[0]}</span><div><h3>{branch.name}</h3><p>{branch.location || 'Lokasi belum diisi'}</p></div><form className="branch-persona" onSubmit={e => { e.preventDefault(); const formData = new FormData(e.currentTarget); void savePersona(branch, String(formData.get('persona') || '')); }}><label>Gaya komunikasi bot<textarea key={`${branch.id}:${branch.persona}`} name="persona" defaultValue={branch.persona} placeholder="Tulis gaya komunikasi cabang" disabled={busy || user.role === 'sales'}/></label>{user.role !== 'sales' && <button className="quiet-btn" type="submit" disabled={busy}>Simpan persona</button>}</form></div>)}</div></section>}
  {page === 'Inbox' && <PilotWorkspace role={user.role} conversations={conversations} selectedId={selectedConversation} messages={messages} onSelect={id => { setSelectedConversation(id); setMessages([]); }} reload={reloadInbox}/>}
  </div></main>{adding && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="live-modal-title"><div className="modal-head"><h2 id="live-modal-title">{adding === 'branch' ? 'Tambah cabang' : 'Tambah akun'}</h2><button className="icon-btn" type="button" aria-label="Tutup" onClick={() => { setAdding(null); setError(''); }}><X size={20}/></button></div><form className="modal-form" onSubmit={save}>{adding === 'branch' ? <><label>Nama cabang<input required autoFocus name="name" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label>Lokasi<input name="location" value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })}/></label></> : <><label>Nama lengkap<input required autoFocus name="name" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label>Email<input required type="email" name="email" autoComplete="off" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })}/></label><label>Password awal (minimal 12 karakter)<input required minLength={12} type="password" name="password" autoComplete="new-password" value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })}/></label>{user.role === 'super' && <label>Peran<select name="role" value={form.role || 'sales'} onChange={e => setForm({ ...form, role: e.target.value })}><option value="sales">Sales</option><option value="admin">Admin cabang</option></select></label>}{form.role === 'sales' && <label>Nomor WhatsApp (angka saja)<input required inputMode="tel" pattern="[0-9]{10,15}" name="phone" value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })}/></label>}<label>Cabang<select required name="branchId" value={form.branchId || ''} onChange={e => setForm({ ...form, branchId: e.target.value })}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></>}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="quiet-btn" type="button" onClick={() => { setAdding(null); setError(''); }}>Batal</button><button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div></form></div></div>}</div>;
}
