import type { ChatStatus, FollowupRule } from './domain';

export type Page = 'Ringkasan' | 'Inbox' | 'Tim sales' | 'Knowledge base' | 'Cabang' | 'Pengaturan';
export type Label = 'Baru' | 'Tertarik' | 'Closing' | 'Batal';
export interface Branch { id: string; name: string; location: string; persona: string }
export interface Sales { id: string; name: string; phone: string; branchId: string; active: boolean; nickname: string }
export interface Message { id: string; text: string; from: 'customer' | 'sales' | 'bot'; at: string }
export interface Chat { id: string; contact: string; phone: string; salesId: string; branchId: string; status: ChatStatus; label: Label; botEnabled: boolean; isNew: boolean; whitelisted: boolean; permanent: boolean; lastMessageAt: string; customerReplied: boolean; followupsSent: number; messages: Message[] }
export interface FAQ { id: string; branchId: string | null; question: string; answer: string; active: boolean }
export interface AppData { branches: Branch[]; sales: Sales[]; chats: Chat[]; faqs: FAQ[]; followup: FollowupRule; providerName: string; modelName: string }

const time = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600000).toISOString();
const msg = (id: string, text: string, from: Message['from'], hoursAgo: number): Message => ({ id, text, from, at: time(hoursAgo) });
export function sampleData(): AppData { return {
  branches: [
    { id: 'b1', name: 'Jakarta Selatan', location: 'Jakarta', persona: 'Ramah, ringkas, dan membantu pelanggan memilih produk yang sesuai.' },
    { id: 'b2', name: 'Yogyakarta', location: 'Yogyakarta', persona: 'Hangat, jelas, dan tidak menjanjikan stok tanpa data.' },
    { id: 'b3', name: 'Bandung', location: 'Bandung', persona: 'Profesional, santai, dan selalu menyarankan langkah berikutnya.' },
  ],
  sales: [
    { id: 's1', name: 'Nadia Putri', phone: '6281234567801', branchId: 'b1', active: true, nickname: 'Nadia' },
    { id: 's2', name: 'Rizky Pratama', phone: '6281234567802', branchId: 'b1', active: true, nickname: 'Rizky' },
    { id: 's3', name: 'Ayu Lestari', phone: '6281234567803', branchId: 'b2', active: true, nickname: 'Ayu' },
    { id: 's4', name: 'Dimas Saputra', phone: '6281234567804', branchId: 'b3', active: true, nickname: 'Dimas' },
  ],
  chats: [
    { id: 'c1', contact: 'Aditya Prakoso', phone: '6281391012001', salesId: 's1', branchId: 'b1', status: 'handover', label: 'Tertarik', botEnabled: false, isNew: true, whitelisted: false, permanent: false, lastMessageAt: time(0.1), customerReplied: true, followupsSent: 0, messages: [msg('m1', 'Halo, ada katalog dan harga produk terbaru?', 'customer', 2), msg('m2', 'Tentu, saya bantu. Produk apa yang sedang Anda cari?', 'bot', 1.9), msg('m3', 'Bisa bicara langsung dengan sales? Saya mau pesan banyak.', 'customer', 0.1), msg('m4', 'Baik, saya hubungkan dengan tim sales kami.', 'bot', 0.09)] },
    { id: 'c2', contact: 'Citra Maharani', phone: '6281391012002', salesId: 's1', branchId: 'b1', status: 'bot', label: 'Baru', botEnabled: true, isNew: true, whitelisted: false, permanent: false, lastMessageAt: time(0.6), customerReplied: true, followupsSent: 0, messages: [msg('m5', 'Apakah bisa kirim ke luar kota?', 'customer', 0.8), msg('m6', 'Untuk informasi pengiriman, saya bantu cek ke tim terlebih dahulu ya.', 'bot', 0.6)] },
    { id: 'c3', contact: 'Bima Wicaksono', phone: '6281391012003', salesId: 's2', branchId: 'b1', status: 'off', label: 'Closing', botEnabled: false, isNew: false, whitelisted: true, permanent: true, lastMessageAt: time(3), customerReplied: true, followupsSent: 0, messages: [msg('m7', 'Terima kasih, saya sudah transfer.', 'customer', 3), msg('m8', 'Siap, saya proses pesanan Anda sekarang.', 'sales', 2.9)] },
    { id: 'c4', contact: 'Sekar Dewi', phone: '6281391012004', salesId: 's3', branchId: 'b2', status: 'handover', label: 'Baru', botEnabled: false, isNew: true, whitelisted: false, permanent: false, lastMessageAt: time(5), customerReplied: true, followupsSent: 0, messages: [msg('m9', 'Saya mau komplain soal pesanan kemarin.', 'customer', 5), msg('m10', 'Maaf atas kendalanya. Saya hubungkan dengan tim sales untuk membantu.', 'bot', 4.9)] },
    { id: 'c5', contact: 'Fajar Ramadhan', phone: '6281391012005', salesId: 's4', branchId: 'b3', status: 'bot', label: 'Tertarik', botEnabled: true, isNew: true, whitelisted: false, permanent: false, lastMessageAt: time(19), customerReplied: false, followupsSent: 0, messages: [msg('m11', 'Ada promo bulan ini?', 'customer', 20), msg('m12', 'Untuk promo terbaru saya perlu cek informasi cabang dulu. Tim kami akan membantu.', 'bot', 19)] },
  ],
  faqs: [
    { id: 'f1', branchId: null, question: 'Bagaimana cara melakukan pemesanan?', answer: 'Kirim nama produk, jumlah, nama penerima, dan alamat pengiriman kepada sales.', active: true },
    { id: 'f2', branchId: 'b1', question: 'Jam operasional Jakarta Selatan?', answer: 'Senin sampai Sabtu, pukul 08.00 sampai 17.00 WIB.', active: true },
    { id: 'f3', branchId: 'b2', question: 'Di mana lokasi cabang Yogyakarta?', answer: 'Hubungi sales cabang Yogyakarta untuk alamat lengkap dan petunjuk arah.', active: true },
  ],
  followup: { enabled: true, count: 2, delays: [24, 72] }, providerName: '', modelName: '',
}; }
