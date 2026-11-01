import { pool } from '../../infrastructure/database/client'

if (process.env.NODE_ENV === 'production')
  throw new Error('Seed data contoh tidak boleh dijalankan di production.')

const client = await pool.connect()
try {
  await client.query('BEGIN')
  const pharmacy = await client.query(`
    INSERT INTO pharmacies (name, address_text, city, postal_codes, latitude, longitude, status, license_reference)
    VALUES ('Apotek Sehat Sentosa', 'Jl. Melati No. 12', 'Jakarta Selatan', ARRAY['12190','12210','12310'], -6.2615, 106.8106, 'active', 'DEMO-ONBOARDING')
    ON CONFLICT (name) DO UPDATE SET status = 'active'
    RETURNING id
  `)
  const pharmacyId = pharmacy.rows[0].id
  const products = [
    [
      'OTC-001',
      'Paracetamol 500 mg',
      'Tablet pereda nyeri dan demam. Gunakan sesuai petunjuk pada kemasan.',
      'Obat bebas',
      'strip isi 10 tablet',
      false,
      '4800.00',
      60,
    ],
    [
      'OTC-002',
      'Vitamin C 500 mg',
      'Suplemen vitamin C.',
      'Vitamin & suplemen',
      'botol isi 30 tablet',
      false,
      '28500.00',
      35,
    ],
    [
      'OTC-003',
      'Oralit',
      'Larutan rehidrasi oral dalam kemasan.',
      'Pertolongan pertama',
      'sachet',
      false,
      '1800.00',
      80,
    ],
    [
      'OTC-004',
      'Plester luka',
      'Plester luka sekali pakai.',
      'Pertolongan pertama',
      'kotak isi 10',
      false,
      '9500.00',
      42,
    ],
    [
      'OTC-005',
      'Termometer digital',
      'Termometer digital untuk pengukuran suhu tubuh.',
      'Alat kesehatan',
      'unit',
      false,
      '59000.00',
      12,
    ],
    [
      'RX-001',
      'Amoxicillin 500 mg',
      'Obat resep. Perlu persetujuan apoteker sebelum pembayaran.',
      'Obat resep',
      'kapsul per 10',
      true,
      '22000.00',
      20,
    ],
    [
      'RX-002',
      'Cetirizine 10 mg',
      'Obat resep. Perlu persetujuan apoteker sebelum pembayaran.',
      'Obat resep',
      'strip isi 10 tablet',
      true,
      '16000.00',
      18,
    ],
  ] as const
  for (const [
    sku,
    name,
    description,
    category,
    sellUnit,
    requiresPrescription,
    unitPrice,
    quantity,
  ] of products) {
    const result = await client.query(
      `
      INSERT INTO products (sku, name, description, category, sell_unit, requires_prescription, status)
      VALUES ($1,$2,$3,$4,$5,$6,'active')
      ON CONFLICT (sku) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category,
        sell_unit=EXCLUDED.sell_unit, requires_prescription=EXCLUDED.requires_prescription, status='active'
      RETURNING id
    `,
      [sku, name, description, category, sellUnit, requiresPrescription],
    )
    await client.query(
      `
      INSERT INTO inventory (pharmacy_id, product_id, on_hand, reserved, unit_price, sales_blocked)
      VALUES ($1,$2,$3,0,$4,false)
      ON CONFLICT (pharmacy_id, product_id) DO UPDATE SET unit_price=EXCLUDED.unit_price, updated_at=now()
    `,
      [pharmacyId, result.rows[0].id, quantity, unitPrice],
    )
  }
  await client.query(
    `
    INSERT INTO pharmacy_service_hours (pharmacy_id, service_type, weekday, opens_at, closes_at, timezone, active)
    SELECT $1, 'prescription', day, '08:00', '20:00', 'Asia/Jakarta', true FROM generate_series(0,6) day
    ON CONFLICT (pharmacy_id, service_type, weekday) DO UPDATE SET opens_at='08:00', closes_at='20:00', active=true
  `,
    [pharmacyId],
  )
  await client.query('COMMIT')
  console.info('Data katalog contoh dimuat. Produk RX contoh hanya untuk pengembangan.')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
