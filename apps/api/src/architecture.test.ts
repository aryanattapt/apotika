import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('.', import.meta.url))
const modulesRoot = join(sourceRoot, 'modules')

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.isFile() && path.endsWith('.ts') ? [path] : []
  }))
  return files.flat()
}

describe('modular monolith boundaries', () => {
  test('each business module exposes a public root facade', async () => {
    const modules = (await readdir(modulesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory())
    for (const module of modules) {
      const facade = join(modulesRoot, module.name, 'index.ts')
      expect((await readFile(facade, 'utf8')).length).toBeGreaterThan(0)
    }
  })

  test('domain code does not depend on infrastructure, presentation, or external framework packages', async () => {
    const files = (await sourceFiles(modulesRoot)).filter((path) => path.split(/[\\/]/).includes('domain') && !path.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source).not.toMatch(/from\s+['"](?:[^'"]*\/(?:infrastructure|presentation)\/[^'"]*|pg|express|bun:[^'"]*)['"]/)
    }
  })

  test('application code depends on ports and domain code, not adapters or HTTP', async () => {
    const files = (await sourceFiles(modulesRoot)).filter((path) => path.split(/[\\/]/).includes('application') && !path.endsWith('.test.ts'))
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source).not.toMatch(/from\s+['"][^'"]*(?:\/infrastructure\/|\/presentation\/|bun:|express|pg)['"]/)
    }
  })

  test('modules import another module only through its public root', async () => {
    const files = (await sourceFiles(modulesRoot)).filter((path) => !path.endsWith('.test.ts'))
    const violations: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const currentModule = relative(modulesRoot, file).split(sep)[0]
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!)
      for (const specifier of imports) {
        if (!specifier.startsWith('.')) continue
        const resolved = resolve(dirname(file), specifier)
        const relativePath = relative(modulesRoot, resolved)
        if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) continue
        const parts = relativePath.split(sep).filter(Boolean)
        if (parts.length > 1 && parts[0] !== currentModule) violations.push(`${relative(sourceRoot, file)} -> ${specifier}`)
      }
    }
    expect(violations).toEqual([])
  })

  test('module adapters do not depend on the outer HTTP composition layer', async () => {
    const files = await sourceFiles(modulesRoot)
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source).not.toMatch(/from\s+['"][^'"]*\/interfaces\//)
    }
  })

  test('HTTP composition imports modules through their public facades', async () => {
    const router = await readFile(join(sourceRoot, 'interfaces/http/router.ts'), 'utf8')
    expect(router).not.toMatch(/from\s+['"]\.\.\/\.\.\/modules\/[^'"]+\//)
  })
})
