import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CartDrawer } from './CartDrawer.jsx'

const callbacks = {
  onClose: () => {},
  onChange: () => {},
  onCheckout: () => {},
}

describe('CartDrawer', () => {
  test('renders a helpful empty state and a way back to shopping', () => {
    const markup = renderToStaticMarkup(createElement(CartDrawer, {
      ...callbacks,
      cart: [],
      subtotal: 0,
    }))
    expect(markup).toContain('Keranjang')
    expect(markup).toContain('Keranjangmu masih kosong')
    expect(markup).toContain('Yuk, temukan kebutuhan sehatmu.')
    expect(markup).toContain('Jelajahi produk')
    expect(markup).not.toContain('Lanjut ke checkout')
  })

  test('shows item counts, prescription notes, subtotal, and checkout action', () => {
    const markup = renderToStaticMarkup(createElement(CartDrawer, {
      ...callbacks,
      cart: [
        {
          id: 'vitamin-c',
          name: 'Vitamin C 500 mg',
          category: 'Vitamin & suplemen',
          sellUnit: 'botol isi 30 tablet',
          indicativePrice: 28500,
          requiresPrescription: false,
          quantity: 2,
        },
        {
          id: 'obat-resep',
          name: 'Obat resep',
          category: 'Obat resep',
          sellUnit: 'strip',
          indicativePrice: 12000,
          requiresPrescription: true,
          quantity: 1,
        },
      ],
      subtotal: 69000,
    }))
    expect(markup).toContain('Keranjang <span>(3)</span>')
    expect(markup).toContain('Vitamin C 500 mg')
    expect(markup).toContain('Obat resep')
    expect(markup).toContain('botol isi 30 tablet')
    expect(markup).toContain('Wajib resep')
    expect(markup).toContain('69.000')
    expect(markup).toContain('Harga dan ketersediaan diperiksa kembali')
    expect(markup).toContain('Lanjut ke checkout')
  })
})
