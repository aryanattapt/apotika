import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Header } from './Header.jsx'

const handlers = {
  onCart: () => {},
  onOrders: () => {},
  onLogin: () => {},
  onLogout: () => {},
  onWorkspace: () => {},
  onShop: () => {},
  onCatalog: () => {},
  onInfoPage: () => {},
}

function renderHeader(props = {}) {
  return renderToStaticMarkup(createElement(Header, {
    ...handlers,
    quantity: 0,
    user: null,
    workspace: 'shop',
    ...props,
  }))
}

describe('Header', () => {
  test('shows the public navigation and login action when signed out', () => {
    const markup = renderHeader()
    expect(markup).toContain('Katalog')
    expect(markup).toContain('Cara pesan')
    expect(markup).toContain('Bantuan')
    expect(markup).toContain('Masuk')
    expect(markup).not.toContain('Pesanan')
    expect(markup).not.toContain('Panel apotek')
    expect(markup).not.toContain('Admin')
  })

  test('shows account and order actions for signed in customers', () => {
    const markup = renderHeader({
      user: { name: 'Arya Paramita', roles: [{ role: 'customer' }] },
      quantity: 2,
    })
    expect(markup).toContain('Arya')
    expect(markup).toContain('Pesanan')
    expect(markup).toContain('Keranjang, 2 item')
    expect(markup).toContain('aria-label="Keluar"')
    expect(markup).not.toContain('Panel apotek')
    expect(markup).not.toContain('Admin')
  })

  test('shows the pharmacy workspace only to pharmacy roles', () => {
    const pharmacist = renderHeader({
      user: { name: 'Apoteker', roles: [{ role: 'pharmacist' }] },
      workspace: 'pharmacy',
    })
    expect(pharmacist).toContain('Panel apotek')
    expect(pharmacist).toContain('Admin')

    const staff = renderHeader({
      user: { name: 'Staf', roles: [{ role: 'pharmacy_staff' }] },
    })
    expect(staff).toContain('Panel apotek')
    expect(staff).not.toContain('Admin')
  })
})
