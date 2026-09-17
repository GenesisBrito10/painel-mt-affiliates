import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = resolve(frontendRoot, '..')
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('MT Affiliates default theme', () => {
  it('uses the approved palette in the affiliate frontend', () => {
    const css = read('frontend/app/assets/css/main.css')
    const config = read('frontend/app.config.ts')
    const nuxt = read('frontend/nuxt.config.ts')
    const auth = read('frontend/app/layouts/auth.vue')

    expect(css).toContain('--vex-brand: #39ff14')
    expect(css).toContain('--vex-bg: #080a08')
    expect(css).toContain('--vex-text: #ffffff')
    expect(config).toContain("primary: 'mtgreen'")
    expect(nuxt).toContain("preference: 'dark'")
    expect(nuxt).toContain("content: '#39FF14'")
    expect(auth).not.toMatch(/245,\s*158,\s*11|168,\s*85,\s*247|124,\s*58,\s*237/)
  })

  it('uses the approved palette in the admin panel and theme reset', () => {
    const css = read('admin/app/assets/css/main.css')
    const config = read('admin/app/app.config.ts')
    const defaults = read('admin/app/pages/theme.vue')

    expect(css).toContain('--color-mtgreen-500: #39FF14')
    expect(css).toContain('--color-bg: #080A08')
    expect(css).toContain('--color-text: #FFFFFF')
    expect(config).toContain("primary: 'mtgreen'")
    expect(defaults).toContain("brand: '#39FF14'")
    expect(defaults).toContain("sidebarBg: '#080A08'")
  })
})
