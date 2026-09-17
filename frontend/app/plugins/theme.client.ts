// Aplica o tema global definido no admin (tabela `settings`).
// Sobrescreve as bases do `main.css` em runtime — variantes light/soft derivam via color-mix.

interface ThemePalette {
  brand: string
  accent: string
  info: string
  positive: string
  negative: string
  warning: string
  sidebarBg: string
  sidebarText: string
  sidebarActive: string
}

const FIELD_TO_VARS: Record<keyof ThemePalette, string[]> = {
  brand: ['--vex-brand'],
  accent: ['--vex-accent'],
  info: ['--vex-info'],
  positive: ['--vex-positive'],
  negative: ['--vex-negative'],
  warning: ['--vex-warning'],
  sidebarBg: ['--vex-sidebar-bg'],
  sidebarText: ['--vex-sidebar-text'],
  sidebarActive: ['--vex-sidebar-text-active']
}

function applyPalette(palette: Partial<ThemePalette>) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [field, value] of Object.entries(palette) as Array<[keyof ThemePalette, string | undefined]>) {
    if (!value || typeof value !== 'string') continue
    const vars = FIELD_TO_VARS[field]
    if (!vars) continue
    for (const v of vars) root.style.setProperty(v, value)
  }

  if (palette.brand) {
    root.style.setProperty('--vex-brand-hover', `color-mix(in srgb, ${palette.brand} 82%, black)`)
    root.style.setProperty('--vex-brand-light', `color-mix(in srgb, ${palette.brand} 14%, white)`)
    root.style.setProperty('--vex-brand-muted', `color-mix(in srgb, ${palette.brand} 10%, transparent)`)
  }

  if (palette.accent) {
    root.style.setProperty('--vex-accent-light', `color-mix(in srgb, ${palette.accent} 14%, white)`)
  }

  if (palette.info) {
    root.style.setProperty('--vex-info-light', `color-mix(in srgb, ${palette.info} 14%, white)`)
  }

  if (palette.positive) {
    root.style.setProperty('--vex-positive-light', `color-mix(in srgb, ${palette.positive} 14%, white)`)
  }

  if (palette.negative) {
    root.style.setProperty('--vex-negative-light', `color-mix(in srgb, ${palette.negative} 14%, white)`)
  }

  if (palette.warning) {
    root.style.setProperty('--vex-warning-light', `color-mix(in srgb, ${palette.warning} 14%, white)`)
  }
}

export default defineNuxtPlugin(() => {
  const apiBase = useApiBase()
  void $fetch<ThemePalette>(`${apiBase}/v1/theme`, {
    timeout: 3000,
  })
    .then(applyPalette)
    .catch(() => {
      // silencioso: mantém defaults do main.css
    })
})
