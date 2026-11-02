import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdminWorkspace } from './AdminWorkspace.jsx'

const handlers = {
  csrf: 'csrf',
  onLogin: () => {},
  onBack: () => {},
  onToast: () => {},
}

const pharmacist = {
  id: 'pharmacist-1',
  roles: [{ role: 'pharmacist', pharmacyId: 'pharmacy-1' }],
}

function renderWorkspace(user) {
  return renderToStaticMarkup(createElement(AdminWorkspace, { ...handlers, user }))
}

describe('AdminWorkspace catalog permissions', () => {
  test('lets pharmacists view the catalog without global product mutation controls', () => {
    const markup = renderWorkspace(pharmacist)
    expect(markup).toContain('Produk dan alokasi stok daring')
    expect(markup).not.toContain('Tambah produk')
    expect(markup).not.toContain('Buat produk nonaktif')
    expect(markup).not.toContain('Aktifkan')
    expect(markup).not.toContain('Nonaktifkan')
  })

  test('keeps customers outside the operational workspace', () => {
    const markup = renderWorkspace({ id: 'customer-1', roles: [{ role: 'customer' }] })
    expect(markup).not.toContain('Produk dan alokasi stok daring')
  })
})
