<template>
  <main
    class="min-h-screen grid lg:grid-cols-[1.1fr_1fr]"
    style="background: var(--color-bg)"
  >
    <!-- Brand panel (desktop only) -->
    <section
      class="relative hidden lg:flex items-center justify-center overflow-hidden border-r"
      style="background: var(--color-surface); border-color: var(--color-border)"
    >
      <!-- Subtle brand stripe pattern -->
      <div
        class="absolute inset-0 stripes pointer-events-none"
        style="opacity: 0.55"
      />

      <!-- Color blooms — soft -->
      <div
        class="absolute -top-32 -left-32 size-[460px] rounded-full blur-3xl pointer-events-none"
        style="background: var(--color-gold); opacity: 0.18"
      />
      <div
        class="absolute -bottom-40 -right-24 size-[420px] rounded-full blur-3xl pointer-events-none"
        style="background: var(--color-purple); opacity: 0.18"
      />

      <div class="relative max-w-md px-12 space-y-10">
        <AppLogo size="lg" />

        <div class="space-y-4">
          <h2 class="text-4xl font-black text-white tracking-tight leading-[1.05]">
            Painel
            <span
              class="italic"
              style="color: var(--color-gold)"
            >administrativo</span>
            da MT Affiliates.
          </h2>
          <p
            class="text-base leading-relaxed"
            style="color: var(--color-text-secondary)"
          >
            Gestão de afiliados, saques, links, casas, prêmios e auditoria — em um único lugar.
          </p>
        </div>
      </div>
    </section>

    <!-- Form panel -->
    <section class="flex items-center justify-center p-6 lg:p-12 relative">
      <!-- Form-side subtle gold gradient at top -->
      <div
        class="absolute top-0 left-0 right-0 h-px pointer-events-none lg:hidden"
        style="background: linear-gradient(90deg, transparent 0%, var(--color-gold) 50%, transparent 100%); opacity: 0.4"
      />
      <div class="w-full max-w-sm">
        <slot />
      </div>
    </section>
  </main>
</template>
