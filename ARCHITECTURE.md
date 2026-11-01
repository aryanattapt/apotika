# Arsitektur FarmaGO

API tetap satu aplikasi dan satu deployment, dengan batas modul berdasarkan kemampuan bisnis. Modul tidak dipisah menjadi service terpisah.

## Bounded context

| Modul | Tanggung jawab utama |
| --- | --- |
| `identity` | Pengguna, sesi, autentikasi, role, MFA |
| `catalog` | Katalog produk yang dapat dilihat pelanggan |
| `customer` | Alamat dan data pelanggan |
| `checkout` | Validasi keranjang, pemilihan apotek, quote harga |
| `orders` | Pembuatan pesanan, idempotensi, status, reservasi, riwayat |
| `prescriptions` | Unggah dokumen, review apoteker, klarifikasi |
| `payments` | Pemeriksaan pembayaran dan kebijakan refund |
| `fulfillment` | Pemeriksaan pesanan, lot, pickup, dan pengiriman |
| `pharmacy` | Stok apotek dan jam layanan |
| `support` | Permintaan pembatalan dan kasus bantuan |
| `administration` | Endpoint operasional untuk admin dan petugas |
| `platform` | Health check dan audit bersama |

## Lapisan modul

```text
modules/<context>/
├── index.ts                  # API publik modul
├── domain/                   # Aturan dan invariant bisnis murni
├── application/              # Use case dan port/repository interface
├── infrastructure/           # Adapter PostgreSQL dan layanan eksternal
└── presentation/http/        # Adapter Request/Response
```

- `domain` tidak mengimpor HTTP, PostgreSQL, atau adapter infrastructure.
- `application` mengatur use case melalui port dan aturan domain; implementasi adapter berada di `infrastructure`.
- `presentation/http` menerjemahkan request dan response, lalu menggunakan use case modul.
- Modul lain hanya boleh mengakses API publik dari `index.ts`, bukan file internalnya.
- `interfaces/http/router.ts` menjadi composition root untuk menggabungkan handler modul. `server.ts` tetap menangani middleware dan lifecycle proses.
- `shared/domain` hanya berisi tipe dan value object lintas modul yang memang stabil; jangan gunakan sebagai tempat memindahkan aturan bisnis khusus.

## Aturan transaksi dan kepemilikan data

- Tabel dan invariant memiliki satu bounded context pemilik. Modul lain meminta operasi melalui facade/use case pemilik tersebut.
- Use case yang perlu perubahan atomik lintas data harus dikoordinasikan secara eksplisit, memakai satu transaksi database dan mencatat event/outbox bila perlu.
- Query lintas domain untuk dashboard operasional ditempatkan sebagai read model, bukan dipakai untuk mengubah data domain lain.
- Jangan menambah SQL atau aturan bisnis baru di adapter HTTP. Saat mengubah endpoint lama, ekstrak transaksi ke use case dan repository modul terkait.

## Domain rules dan pengujian

Aturan yang sudah dipisahkan dan diuji mencakup normalisasi keranjang dan pembentukan quote, transisi status pesanan, kelengkapan review resep, batas refund, jam layanan apotek, serta jumlah lot pemenuhan. Tes arsitektur memastikan domain/application tetap bebas adapter dan modul saling memakai facade publik.

Jalankan tes API dengan `bun run test:api` dan build dengan `bun run build:api`. Workflow `.github/workflows/api-ci.yml` menjalankan keduanya pada push, pull request, atau manual dispatch.

## Migrasi endpoint lama

Semua handler HTTP sekarang berada di `modules/<context>/presentation/http`. Beberapa handler lama masih berisi transaksi SQL yang belum diekstrak. Saat disentuh berikutnya, pindahkan query ke repository dan orkestrasi bisnis ke application service tanpa mengubah kontrak endpoint. Quote checkout dan query detail pesanan sudah memakai lapisan application/domain/repository sebagai pola acuan.

## Web

```text
apps/web/src/
├── app/                      # Komposisi aplikasi dan state halaman utama
├── components/               # Komponen layout dan UI lintas fitur
├── features/                 # Auth, katalog, checkout, pesanan, apotek, admin
├── shared/api/               # Client HTTP
├── shared/lib/               # Formatter dan helper tampilan
└── main.jsx                  # Entry point React
```

Komponen fitur boleh menggunakan client API dan helper tampilan dari `shared`, tetapi halaman baru tetap berada di folder fitur, bukan di `main.jsx`.
