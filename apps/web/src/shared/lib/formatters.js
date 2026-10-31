export const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0))
export const statusLabel = {
  awaiting_prescription: 'Menunggu resep', awaiting_payment: 'Menunggu pembayaran', paid: 'Dibayar', processing: 'Disiapkan',
  ready: 'Siap diambil', in_delivery: 'Dalam pengiriman', completed: 'Selesai', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa',
}
