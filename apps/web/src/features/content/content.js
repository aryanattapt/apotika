export const infoPages = {
  about: {
    label: 'TENTANG FARMAGO',
    title: 'Teman praktis untuk kebutuhan kesehatanmu.',
    intro: 'FarmaGO dirancang untuk membantu pelanggan menemukan produk kesehatan dari apotek mitra dan memahami proses pemesanannya.',
    sections: [
      { icon: 'MapPin', title: 'Terhubung dengan apotek mitra', body: 'Setiap pesanan dipenuhi oleh satu apotek yang memenuhi wilayah layanan dan ketersediaan seluruh item.' },
      { icon: 'Stethoscope', title: 'Resep tetap ditinjau apoteker', body: 'Produk dengan label resep hanya dapat dilanjutkan setelah diperiksa dan disetujui oleh apoteker yang berwenang.' },
      { icon: 'HeartPulse', title: 'Belanja yang lebih jelas', body: 'Harga dan stok diperiksa ulang sebelum pesanan dibuat. Jika rinciannya berubah, pelanggan dapat meninjau dan menyetujui ulang.' }
    ]
  },
  'how-to-order': {
    label: 'CARA PEMESANAN',
    title: 'Belanja dengan langkah yang jelas.',
    intro: 'Ikuti langkah berikut untuk memahami alur pemesanan FarmaGO.',
    sections: [
      { icon: 'ShoppingBag', title: '1. Cari dan pilih produk', body: 'Jelajahi katalog, buka detail produk, lalu tambahkan produk yang dibutuhkan ke keranjang. Harga katalog bersifat indikatif.' },
      { icon: 'FileText', title: '2. Tinjau rincian akhir', body: 'Saat checkout, sistem memeriksa kembali harga dan ketersediaan. Jika ada perubahan, tinjau rincian terbaru sebelum menyetujui pesanan.' },
      { icon: 'ShieldCheck', title: '3. Selesaikan pemeriksaan resep', body: 'Jika ada produk resep, unggah resep yang diminta. Apoteker perlu meninjau dan menyetujui item resep sebelum pembayaran atau pemenuhan.' },
      { icon: 'PackageCheck', title: '4. Pilih apotek dan pantau pesanan', body: 'Pesanan dipenuhi oleh satu apotek. Pada versi saat ini, pengambilan di apotek tersedia; pengiriman belum aktif.' }
    ],
    notice: 'Integrasi pembayaran belum tersedia pada versi ini. Tagihan belum dapat dibuat sampai penyedia pembayaran terhubung.'
  },
  support: {
    label: 'BANTUAN & DUKUNGAN',
    title: 'Ada yang ingin ditanyakan?',
    intro: 'Berikut jawaban singkat mengenai katalog, resep, dan status pemesanan.',
    sections: [
      { icon: 'Stethoscope', title: 'Mengapa produk resep perlu ditinjau?', body: 'Produk dengan label resep memerlukan pemeriksaan dan persetujuan apoteker berwenang sebelum dapat dipenuhi.' },
      { icon: 'PackageCheck', title: 'Kenapa harga atau stok bisa berubah?', body: 'Harga dan ketersediaan diperiksa kembali saat checkout. Jika hasilnya berbeda, sistem meminta persetujuan atas rincian terbaru.' },
      { icon: 'MapPin', title: 'Apakah pesanan bisa dikirim?', body: 'Pengiriman belum aktif pada versi ini. Pilihan yang tersedia adalah pengambilan di apotek mitra.' },
      { icon: 'HelpCircle', title: 'Bagaimana menghubungi tim bantuan?', body: 'Saluran kontak langsung belum tersedia di versi ini. Halaman ini menyediakan panduan umum penggunaan FarmaGO.' }
    ]
  },
  privacy: {
    label: 'KEBIJAKAN PRIVASI',
    title: 'Privasi dan data kesehatan perlu ditangani hati-hati.',
    intro: 'Halaman ini menjelaskan pendekatan privasi yang direncanakan untuk FarmaGO.',
    draft: true,
    sections: [
      { icon: 'LockKeyhole', title: 'Data yang dapat diproses', body: 'Aplikasi dapat memproses informasi akun dan kontak, alamat yang dipilih, rincian transaksi, serta dokumen resep yang diunggah pelanggan.' },
      { icon: 'ShieldCheck', title: 'Penggunaan dan akses', body: 'Data digunakan untuk mendukung verifikasi akun, pemrosesan pesanan, pemeriksaan resep, keamanan, dan pencatatan aktivitas. Akses operasional dirancang berdasarkan peran, penugasan, dan kebutuhan kerja.' },
      { icon: 'FileText', title: 'Penyimpanan dan masa retensi', body: 'Penyimpanan produksi, masa retensi, proses permintaan akses atau penghapusan data, dan kontak pengelola data masih menunggu keputusan serta peninjauan legal.' }
    ]
  },
  terms: {
    label: 'SYARAT LAYANAN',
    title: 'Ketentuan penggunaan FarmaGO.',
    intro: 'Ringkasan berikut menjelaskan rancangan alur layanan dan belum menjadi syarat layanan final.',
    draft: true,
    sections: [
      { icon: 'ShoppingBag', title: 'Katalog dan harga', body: 'Harga katalog bersifat indikatif. Harga serta ketersediaan diperiksa kembali saat checkout, dan perubahan perlu disetujui sebelum pesanan dibuat.' },
      { icon: 'Stethoscope', title: 'Produk resep', body: 'Produk resep hanya dapat dipenuhi setelah persetujuan apoteker yang berwenang. Keputusan profesional tetap berada pada apoteker.' },
      { icon: 'PackageCheck', title: 'Pemenuhan dan pembayaran', body: 'Versi saat ini mendukung pengambilan di apotek. Pengiriman dan pembuatan tagihan belum aktif sampai integrasi terkait tersedia.' },
      { icon: 'HelpCircle', title: 'Bukan layanan darurat', body: 'FarmaGO tidak ditujukan untuk keadaan darurat medis. Hubungi layanan gawat darurat atau fasilitas kesehatan setempat untuk bantuan segera.' }
    ]
  }
}

export const relatedInfoPages = [
  ['about', 'Tentang FarmaGO'],
  ['how-to-order', 'Cara pemesanan'],
  ['support', 'Bantuan & dukungan'],
  ['privacy', 'Kebijakan privasi'],
  ['terms', 'Syarat layanan']
]
