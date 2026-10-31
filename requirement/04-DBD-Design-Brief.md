# Design Brief Document — Apotek Digital MVP

**Versi:** 0.4 · **Status:** arahan desain awal ditinjau  
**Terkait:** [PRD](01-PRD.md) · [App Flow](03-AFD-App-Flow.md)

## 1. Tujuan desain

Membuat pembelian produk kesehatan dan penebusan resep mudah dipahami, terutama pada perangkat seluler, sambil memberi petugas apotek informasi yang dibutuhkan untuk bekerja dengan aman. Desain harus membangun kepercayaan melalui informasi yang jelas dan status yang dapat dilacak.

## 2. Audiens dan konteks

| Pengguna | Konteks | Kebutuhan desain |
|---|---|---|
| Pelanggan | Mengakses web dari ponsel, dapat sedang membutuhkan produk segera | Pencarian mudah, informasi biaya dan status jelas. |
| Apoteker | Memeriksa resep dalam antrean | Dokumen terbaca, data relevan, keputusan dan klarifikasi mudah dicatat. |
| Staf apotek | Menyiapkan beberapa pesanan | Urutan kerja jelas, status dan kendala terlihat. |
| Admin/CS | Menangani transaksi dan pertanyaan | Pencarian berdasarkan ID, riwayat, dan tindakan sesuai izin. |

## 3. Prinsip desain

- **Jelas:** gunakan bahasa Indonesia sederhana, nama status konsisten, dan rincian biaya sebelum konfirmasi.
- **Aman:** tampilkan label wajib resep dan jangan menyiratkan bahwa persetujuan otomatis atau diagnosis tersedia.
- **Privat:** sembunyikan informasi kesehatan dari tampilan dan notifikasi yang tidak memerlukannya.
- **Mudah dipakai:** responsif, teks terbaca, target sentuh memadai, label formulir jelas, dan dukungan keyboard.
- **Dapat dipulihkan:** jelaskan penyebab kegagalan dan tindakan berikutnya, misalnya memperbarui alamat atau membuat pesanan baru.

## 4. Arsitektur informasi

**Pelanggan:** Beranda → Katalog/detail → Keranjang → Alamat & pemenuhan → Konfirmasi → Resep jika perlu → Pembayaran → Detail pesanan → Riwayat/bantuan.

**Apotek:** Masuk → Antrean resep → Detail pemeriksaan → Pesanan terbayar → Penyiapan → Serah terima → Kendala.

**Admin:** Masuk → Ringkasan → Apotek → Katalog → Pesanan/keluhan → Refund → Audit.

## 5. Layar prioritas dan isi minimum

| Layar | Elemen minimum |
|---|---|
| Katalog | Pencarian, kategori, produk, harga indikatif, label resep. |
| Detail produk | Nama, informasi produk yang disetujui, harga indikatif, jumlah, tindakan tambah. |
| Checkout | Metode, apotek, item, subtotal, diskon, ongkir, total, konfirmasi; alamat hanya wajib untuk pengiriman. Tampilkan jam layanan resep bila keranjang memerlukan resep. |
| Unggah resep | Petunjuk foto yang terbaca, privasi, unggah, status pemeriksaan dan batas waktu reservasi. |
| Pembayaran | Jumlah, penyedia, instruksi, waktu berakhir, status. |
| Detail pesanan | Status terkini, riwayat, opsi bantuan, pengiriman/pengambilan. |
| Antrean resep | ID pesanan, waktu masuk, status, penugasan, tindakan periksa. |
| Pemeriksaan resep | Dokumen, item, kolom klarifikasi/keputusan, identitas apoteker, konfirmasi tindakan. |
| Panel pemenuhan | Item dan satuan jual, jumlah, pemeriksaan kondisi/kedaluwarsa, catatan lot bila relevan, petugas pemeriksa, opsi tandai siap, bukti serah terima, atau laporkan kendala. |

## 6. Arahan visual dan komponen

Gunakan identitas visual orisinal, jangan menyalin logo atau aset K24Klik. Arah awal: warna utama hijau yang tenang, latar netral, tipografi sans-serif yang mudah dibaca, dan warna status yang disertai teks/ikon. Nilai warna dan branding final ditentukan setelah uji kontras dan persetujuan pemilik produk.

Komponen minimum: tombol primer/sekunder, input dengan label dan pesan kesalahan, kartu produk, label resep/status, langkah checkout, rincian biaya, dialog konfirmasi, tabel responsif, unggah file, notifikasi, dan keadaan kosong/loading/error.

## 7. Interaksi penting

- Sebelum membuat pesanan, jelaskan biaya dan bahwa stok direservasi untuk waktu terbatas.
- Jika harga atau ongkir berubah sebelum pesanan dibuat, tampilkan rincian baru dan minta konfirmasi ulang; jangan menyelesaikan pesanan diam-diam.
- Saat resep butuh klarifikasi, tampilkan permintaan apoteker dan jalur respons yang jelas.
- Saat reservasi habis, jelaskan bahwa pelanggan perlu membuat pesanan baru dan harga/stok dapat berubah.
- Untuk penolakan resep atau stok habis, hindari pesan yang menghakimi; arahkan ke bantuan.
- Jangan menampilkan diagnosis, isi resep, atau nama produk sensitif dalam notifikasi layar terkunci.
- Tampilkan status tagihan sedang dibuat atau refund sedang diperiksa sebagai proses yang belum selesai; hindari mendorong pelanggan mengulang pembayaran saat hasil penyedia belum pasti.
- Setelah paket diserahkan, arahkan kendala ke bantuan; tombol pembatalan langsung tidak tersedia. Refund ditampilkan terpisah agar pelanggan tetap mengetahui lokasi/status fisik pesanan.
- Informasi pasien, resep dan catatan klinis hanya tampil pada layar berwenang. Nama produk atau ringkasan klinis tidak muncul di notifikasi umum.

## 8. Hasil desain dan validasi

Hasil yang diharapkan: sitemap, user flow, wireframe layar prioritas, prototipe responsif, panduan komponen, serta spesifikasi handoff ke React. Uji setidaknya pencarian, unggah resep, pembayaran, dan pemantauan pesanan dengan pelanggan dan apoteker pilot. Keputusan final membutuhkan riset pengguna; brief ini belum merupakan hasil riset.
