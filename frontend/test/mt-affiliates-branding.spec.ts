import { existsSync, readFileSync } from 'node:fs'
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

  it('uses MT Affiliates text and icons across all user-facing surfaces', () => {
    const brandedSources = [
      'nuxt.config.ts',
      'app/app.vue',
      'app/spa-loading-template.html',
      'public/manifest.webmanifest',
      'public/sw-push.js',
      '../admin/nuxt.config.ts',
      '../admin/app/app.vue',
      '../admin/app/layouts/auth.vue',
      '../admin/app/pages/auth/login.vue',
      '../admin/app/pages/withdrawals.vue',
      '../admin/public/manifest.webmanifest',
      '../backend-vexxa/src/modules/auth/application/auth.service.ts',
      '../backend-vexxa/src/modules/superbet-inactivity/superbet-inactivity.service.ts',
      '../backend-vexxa/src/modules/notification/application/notification.service.ts',
      '../backend-vexxa/src/modules/user/application/affiliate-export.service.ts',
      '../backend-vexxa/src/modules/withdrawal/application/receipt-generator.service.ts',
      '../backend-vexxa/src/modules/whatsapp/domain/types/whatsapp.types.ts',
      '../backend-vexxa/src/modules/whatsapp/infrastructure/whatsapp.controller.ts',
      '../backend-vexxa/src/modules/whatsapp/infrastructure/queues/whatsapp-proof.producer.ts',
      '../backend-vexxa/.env.example',
    ].map(read)

    expect(brandedSources.join('\n')).not.toMatch(
      /Vallex Group|Vallex Company|da Vallex|pela Vallex/i,
    )
    expect(brandedSources.join('\n')).not.toMatch(
      /\/vallex-(?:favicon|icon|apple-touch-icon|logo)/i,
    )
    expect(JSON.parse(read('../admin/public/manifest.webmanifest'))).toMatchObject({
      name: 'MT Affiliates Admin',
      short_name: 'MT Admin',
      description: 'Painel administrativo MT Affiliates',
    })
    expect(read('../backend-vexxa/src/modules/withdrawal/application/receipt-generator.service.ts'))
      .not.toMatch(/RECEIPT_BRAND_NAME[^\n]*['"]VALLEX['"]/)

    for (const appRoot of ['.', '../admin']) {
      for (const asset of [
        'mt-affiliates-favicon.ico',
        'mt-affiliates-apple-touch-icon.png',
        'mt-affiliates-icon-192.png',
        'mt-affiliates-icon-512.png',
      ]) {
        expect(existsSync(resolve(frontendRoot, appRoot, 'public', asset))).toBe(true)
      }
    }
  })
})
