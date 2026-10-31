# Struktur Arsitektur

Repo ini memakai **Clean Architecture ringan dengan pengelompokan per fitur**. DDD penuh belum diperlukan untuk ukuran MVP saat ini; aturan bisnis yang sudah jelas dikelompokkan lewat fitur, lalu pemisahan use case dan repository bisa dilakukan bertahap.

## API

```text
apps/api/src/
├── application/
│   └── jobs/                 # Proses latar belakang, tidak bergantung pada HTTP
├── infrastructure/
│   ├── database/             # Pool PostgreSQL dan migration
│   └── security/             # Adapter keamanan seperti TOTP/MFA
├── interfaces/
│   ├── cli/                  # Perintah migration, seed, dan provisioning
│   └── http/
│       ├── router.ts         # Urutan route dan gerbang autentikasi
│       └── routes/           # Handler HTTP per fitur
├── shared/                   # Error, validasi, dan helper lintas fitur
└── server.ts                 # Composition root Bun
```

`server.ts` menghubungkan server HTTP, router, dan job. Route dikelompokkan menurut kemampuan: auth, katalog, checkout, pesanan, resep, pembayaran, pemenuhan, apotek, dan operasi admin.

Untuk menjaga perilaku MVP tetap sama, handler route saat ini masih memuat sebagian aturan use case dan query SQL. Saat fitur berikutnya dikembangkan, pindahkan aturan bisnis ke `application/<fitur>` dan query ke repository di `infrastructure/<fitur>`; route kemudian cukup menerjemahkan HTTP request/response. Jangan menambah lapisan kosong yang belum punya tanggung jawab nyata.

## Web

```text
apps/web/src/
├── app/                      # Komposisi aplikasi dan state halaman utama
├── components/               # Komponen layout dan UI yang dipakai lintas fitur
├── features/                 # Auth, katalog, checkout, pesanan, apotek, dan admin
├── shared/
│   ├── api/                  # Client HTTP
│   └── lib/                  # Formatter dan helper tampilan
├── main.jsx                  # Entry point React
└── styles.css
```

Komponen fitur boleh menggunakan client API dan helper tampilan dari `shared`, tetapi hindari menaruh komponen halaman baru kembali ke `main.jsx`.
