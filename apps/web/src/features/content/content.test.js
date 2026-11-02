import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Footer } from '../../components/layout/Footer.jsx'
import { infoPages, relatedInfoPages } from './content.js'

const pageIds = ['about', 'how-to-order', 'support', 'privacy', 'terms']

describe('web information pages', () => {
  test('defines every information destination shown by the footer', () => {
    expect(Object.keys(infoPages).sort()).toEqual([...pageIds].sort())
    expect(relatedInfoPages.map(([id]) => id).sort()).toEqual([...pageIds].sort())
  })

  for (const id of pageIds) {
    test(`${id} has a title and readable content`, () => {
      const page = infoPages[id]
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.sections.length).toBeGreaterThan(0)
      for (const section of page.sections) {
        expect(section.title.length).toBeGreaterThan(0)
        expect(section.body.length).toBeGreaterThan(0)
      }
    })
  }

  test('labels privacy and terms as drafts', () => {
    expect(infoPages.privacy.draft).toBe(true)
    expect(infoPages.terms.draft).toBe(true)
    expect(infoPages.about.draft).toBeUndefined()
  })

  test('includes the current payment integration limitation in order guidance', () => {
    expect(infoPages['how-to-order'].notice).toContain('Integrasi pembayaran belum tersedia')
  })

  test('footer links to each static information page', () => {
    const markup = renderToStaticMarkup(createElement(Footer, {
      onNavigate: () => {},
      onCatalog: () => {}
    }))
    for (const id of pageIds) {
      expect(markup).toContain(`href="?page=${id}"`)
    }
  })
 
  test('footer includes its pharmacy and emergency guidance', () => {
    const markup = renderToStaticMarkup(createElement(Footer, {
      onNavigate: () => {},
      onCatalog: () => {}
    }))
    expect(markup).toContain('Teman praktis untuk kebutuhan kesehatanmu')
    expect(markup).toContain('Belanja lebih tenang')
    expect(markup).toContain('Keputusan resep tetap pada apoteker berwenang.')
    expect(markup).toContain('Belum untuk penggunaan darurat.')
    expect(markup).toContain('Informasi produk mengikuti kemasan')
  })
})
