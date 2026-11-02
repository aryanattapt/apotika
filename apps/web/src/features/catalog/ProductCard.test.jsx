import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductCard } from './ProductCard.jsx'

const baseProduct = {
  id: 'vitamin-c',
  name: 'Vitamin C 500 mg',
  category: 'Vitamin & suplemen',
  sellUnit: 'botol isi 30 tablet',
  indicativePrice: 28500,
  requiresPrescription: false,
  available: true,
}

function renderProduct(product = baseProduct, quantity = 0) {
  return renderToStaticMarkup(createElement(ProductCard, {
    product,
    quantity,
    onAdd: () => {},
    onRemove: () => {},
    delay: 40,
  }))
}

describe('ProductCard', () => {
  test('renders product details, price, category styling, and the add control', () => {
    const markup = renderProduct()
    expect(markup).toContain('Vitamin C 500 mg')
    expect(markup).toContain('Vitamin &amp; suplemen')
    expect(markup).toContain('botol isi 30 tablet')
    expect(markup).toContain('28.500')
    expect(markup).toContain('product-visual mint')
    expect(markup).toContain('animation-delay:40ms')
    expect(markup).toContain('class="add-button"')
    expect(markup).not.toContain('disabled=""')
  })

  test('marks prescription products and disables adding unavailable products', () => {
    const markup = renderProduct({
      ...baseProduct,
      requiresPrescription: true,
      available: false,
    })
    expect(markup).toContain('class="rx-tag">Resep</span>')
    expect(markup).toContain('class="add-button" disabled=""')
    expect(markup).toContain('Habis')
  })

  test('shows the quantity stepper instead of the add button for cart items', () => {
    const markup = renderProduct(baseProduct, 2)
    expect(markup).toContain('class="quantity-stepper"')
    expect(markup).toContain('<b>2</b>')
    expect(markup).toContain('aria-label="Kurangi"')
    expect(markup).toContain('aria-label="Tambah"')
    expect(markup).not.toContain('class="add-button"')
  })
})
