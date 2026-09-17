import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(resolve(frontendRoot, path), 'utf8')

describe('MT Affiliates branding', () => {
  it('replaces the former brand in every user-facing frontend text', () => {
    const userFacingSources = [
      'nuxt.config.ts',
      'app/spa-loading-template.html',
      'app/layouts/auth.vue',
      'app/pages/api-webhook.vue',
      'app/pages/earnings.vue',
      'public/manifest.webmanifest',
      'public/sw-push.js',
    ].map(read)

    expect(userFacingSources.join('\n')).not.toMatch(/Vallex Group/i)
    expect(read('nuxt.config.ts')).toContain("title: 'MT Affiliates'")
    expect(JSON.parse(read('public/manifest.webmanifest'))).toMatchObject({
      name: 'MT Affiliates',
      short_name: 'MT Affiliates',
      description: 'Painel de afiliados MT Affiliates',
    })
    expect(read('app/layouts/auth.vue')).not.toMatch(/>Vallex</)
    expect(read('app/pages/api-webhook.vue')).not.toMatch(
      /\b(?:A|da|na|painel|sistema da)\s+Vallex\b/i,
    )
  })
})
