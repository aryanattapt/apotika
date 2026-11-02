import { describe, expect, test } from 'bun:test'
import { Activity, FileHeart, HeartPulse, Pill } from 'lucide-react'
import { categoryColor, categoryIcon } from './catalog.js'

describe('catalog category presentation', () => {
  test('maps the named product categories to the expected icon and color', () => {
    expect(categoryIcon('Vitamin & suplemen')).toBe(HeartPulse)
    expect(categoryColor('Vitamin & suplemen')).toBe('mint')
    expect(categoryIcon('Alat kesehatan')).toBe(Activity)
    expect(categoryColor('Alat kesehatan')).toBe('blue')
    expect(categoryIcon('Pertolongan pertama')).toBe(FileHeart)
    expect(categoryColor('Pertolongan pertama')).toBe('peach')
  })

  test('uses the medicine fallback for other and missing categories', () => {
    expect(categoryIcon('Obat bebas')).toBe(Pill)
    expect(categoryColor('Obat bebas')).toBe('lilac')
    expect(categoryIcon(undefined)).toBe(Pill)
    expect(categoryColor(undefined)).toBe('lilac')
  })
})
