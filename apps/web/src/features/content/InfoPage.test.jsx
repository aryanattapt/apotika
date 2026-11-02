import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InfoPage } from './InfoPage.jsx'
import { infoPages, relatedInfoPages } from './content.js'

const handlers = { onBack: () => {}, onNavigate: () => {} }
const pageIds = ['about', 'how-to-order', 'support', 'privacy', 'terms']

describe('InfoPage', () => {
  for (const pageId of pageIds) {
    test('renders all sections for ' + pageId, () => {
      const content = infoPages[pageId]
      const markup = renderToStaticMarkup(createElement(InfoPage, {
        ...handlers,
        page: pageId,
      }))
      expect(markup).toContain(content.title)
      expect(markup).toContain(content.intro)
      for (const section of content.sections) {
        expect(markup).toContain(section.title)
        expect(markup).toContain(section.body)
      }
      expect(markup).toContain('Informasi lainnya')
      expect(markup).toContain('Kembali ke katalog')
    })
  }

  test('shows the legal review note for draft policies', () => {
    for (const page of ['privacy', 'terms']) {
      const markup = renderToStaticMarkup(createElement(InfoPage, { ...handlers, page }))
      expect(markup).toContain('Informasi draf')
      expect(markup).toContain('menunggu validasi product owner')
    }
    const about = renderToStaticMarkup(createElement(InfoPage, { ...handlers, page: 'about' }))
    expect(about).not.toContain('Informasi draf')
  })

  test('shows page notices and falls back to the about page for unknown IDs', () => {
    const orderGuide = renderToStaticMarkup(createElement(InfoPage, {
      ...handlers,
      page: 'how-to-order',
    }))
    expect(orderGuide).toContain(infoPages['how-to-order'].notice)
    expect(orderGuide).toContain('Integrasi pembayaran belum tersedia')
    const unknown = renderToStaticMarkup(createElement(InfoPage, {
      ...handlers,
      page: 'unrecognized-page',
    }))
    expect(unknown).toContain(infoPages.about.title)
  })

  test('lists every other page as an information destination', () => {
    for (const page of pageIds) {
      const markup = renderToStaticMarkup(createElement(InfoPage, {
        ...handlers,
        page,
      }))
      const expectedLinks = relatedInfoPages.filter(([id]) => id !== page)
      expect((markup.match(/<button /g) || []).length).toBe(expectedLinks.length + 1)
      for (const [, label] of expectedLinks) expect(markup).toContain(label)
    }
  })
})
