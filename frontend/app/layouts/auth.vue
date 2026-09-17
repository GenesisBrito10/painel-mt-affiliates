<script setup lang="ts">
const year = new Date().getFullYear()

const features = [
  { icon: 'i-lucide-shield-check', title: 'Segurança', subtitle: 'Seus dados protegidos' },
  { icon: 'i-lucide-zap', title: 'Performance', subtitle: 'Ferramentas para escalar resultados' },
  { icon: 'i-lucide-handshake', title: 'Parcerias', subtitle: 'As melhores casas do mercado' },
]
</script>

<template>
  <!-- Dark mode is forced via `colorMode: 'dark'` page meta on each auth
       page (not a `dark` class here) — a class on this div would re-trigger
       main.css's static `.dark { --vex-* }` fallbacks on this subtree,
       shadowing the admin-configured palette that plugins/theme.client.ts
       injects onto <html>. -->
  <div class="relative min-h-screen overflow-hidden" style="background: #0a0b0d">
    <!-- Ambient glow — echoes the MT green → silver contrast -->
    <div class="pointer-events-none fixed inset-0 overflow-hidden">
      <div class="absolute -top-40 left-[4%] size-[34rem] rounded-full blur-[160px]" style="background: rgba(57, 255, 20, 0.16)" />
      <div class="absolute top-1/4 right-[2%] size-[30rem] rounded-full blur-[160px]" style="background: rgba(57, 255, 20, 0.10)" />
      <div class="absolute -bottom-52 left-[26%] h-[26rem] w-[40rem] rounded-full blur-[160px]" style="background: rgba(255, 255, 255, 0.05)" />
    </div>

    <!-- Giant faint watermark -->
    <div class="pointer-events-none fixed inset-0 flex items-center justify-end overflow-hidden" aria-hidden="true">
      <span class="vex-auth-watermark">MT Affiliates</span>
    </div>

    <div class="relative z-10 mx-auto flex min-h-screen w-full max-w-[92rem] flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-14 lg:py-10">
      <!-- Logo -->
      <div class="shrink-0">
        <AppLogo variant="dark" size="md" />
      </div>

      <!-- Hero -->
      <div class="relative flex-1 py-10 lg:py-6">
        <!-- Top notification row — mirrors the content grid below (same
             1fr/auto columns) so each card sits aligned above the thing it
             relates to, instead of floating in unrelated empty space. -->
        <div class="mb-4 hidden grid-cols-[1fr_auto] gap-10 xl:grid">
          <div class="flex justify-center">
            <AuthFloatingCard
              icon="i-lucide-target"
              tone="warning"
              title="Meta diária atingida"
              subtitle="127% da meta concluída"
              time="Hoje, 16:45"
              style="animation-delay: 2.8s"
            />
          </div>
          <div class="flex w-[26rem] justify-end">
            <AuthFloatingCard
              icon="i-lucide-wallet"
              tone="positive"
              title="Pagamento aprovado"
              subtitle="R$ 4.750,00 disponível"
              time="2 min atrás"
              style="animation-delay: 1.4s"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 items-start gap-14 lg:grid-cols-[1fr_auto] lg:gap-10">
          <!-- Marketing copy -->
          <div class="max-w-xl">
            <p class="text-xs font-semibold uppercase tracking-[0.16em]" style="color: var(--vex-shell-dark-subtle)">
              Affiliate Management
            </p>
            <h1 class="vex-title mt-3 text-[2.25rem] font-bold leading-[1.08] text-white sm:text-[2.75rem]">
              Bem-vindo à<br>
              <span class="vex-auth-gradient-text">MT Affiliates</span>
            </h1>
            <p class="mt-5 max-w-md text-[15px] leading-relaxed" style="color: var(--vex-shell-dark-label)">
              A plataforma que conecta afiliados às melhores oportunidades do mercado.
            </p>
            <p class="mt-3 max-w-md text-[15px] leading-relaxed" style="color: var(--vex-shell-dark-label)">
              Gerencie acordos, acompanhe resultados e escale sua operação em
              <span class="vex-auth-gradient-text font-semibold">um único lugar</span>.
            </p>

            <div class="mt-9 grid max-w-md grid-cols-3 gap-3">
              <div v-for="f in features" :key="f.title" class="flex flex-col gap-2">
                <span
                  class="flex size-8 items-center justify-center rounded-lg"
                  style="background: var(--vex-shell-dark-surface)"
                >
                  <UIcon :name="f.icon" class="size-4" style="color: var(--vex-brand-hover)" />
                </span>
                <div>
                  <p class="text-[13px] font-semibold text-white">{{ f.title }}</p>
                  <p class="mt-0.5 text-[11.5px] leading-snug" style="color: var(--vex-shell-dark-faint)">
                    {{ f.subtitle }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Login card -->
          <div
            class="relative mx-auto w-full max-w-md rounded-2xl border p-5 sm:p-8 lg:mx-0 lg:w-[26rem]"
            style="background: rgba(22, 25, 29, 0.72); border-color: rgba(255, 255, 255, 0.1); backdrop-filter: blur(20px); box-shadow: 0 30px 60px -24px rgba(0, 0, 0, 0.75)"
          >
            <slot />
          </div>
        </div>

        <!-- Bottom notification row — same column-mirroring approach. -->
        <div class="mt-6 hidden grid-cols-[1fr_auto] gap-10 xl:grid">
          <div class="flex justify-start pl-[6%]">
            <AuthFloatingCard
              icon="i-lucide-bar-chart-3"
              tone="info"
              title="Relatório atualizado"
              subtitle="Novos dados disponíveis"
              time="Hoje, 15:30"
              style="animation-delay: 0.7s"
            />
          </div>
          <div class="flex w-[26rem] justify-end">
            <AuthFloatingCard
              icon="i-lucide-handshake"
              tone="brand"
              title="Novo parceiro"
              subtitle="Zona de Jogo liberado"
              time="Hoje, 14:20"
              style="animation-delay: 2.1s"
            />
          </div>
        </div>
      </div>

      <!-- Partner houses -->
      <AuthPartnersBar class="shrink-0" />

      <footer class="mt-6 shrink-0 text-center">
        <p class="text-[11px]" style="color: var(--vex-shell-dark-faint)">
          &copy; {{ year }} MT Affiliates. Todos os direitos reservados.
        </p>
      </footer>
    </div>
  </div>
</template>
