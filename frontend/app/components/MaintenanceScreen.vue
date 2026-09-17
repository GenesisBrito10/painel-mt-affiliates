<script setup lang="ts">
const { state, refresh } = useMaintenance()

const refreshing = ref(false)
async function tryAgain() {
  refreshing.value = true
  await refresh()
  refreshing.value = false
}
</script>

<template>
  <div class="vex-maint-screen">
    <div class="vex-maint-card">
      <div class="vex-maint-badge">
        <UIcon name="i-lucide-construction" class="size-4" />
        <span>Manutencao</span>
      </div>

      <h1 class="vex-maint-title">{{ state.title }}</h1>
      <p class="vex-maint-message">{{ state.message }}</p>

      <button class="vex-maint-button" :disabled="refreshing" @click="tryAgain">
        <UIcon
          name="i-lucide-refresh-cw"
          class="size-4"
          :class="{ 'animate-spin': refreshing }"
        />
        <span>{{ refreshing ? 'Atualizando...' : 'Tentar novamente' }}</span>
      </button>

      <div class="vex-maint-footnote">Atualizacao automatica a cada 30 segundos</div>
    </div>
  </div>
</template>

<style scoped>
.vex-maint-screen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--vex-brand) 10%, transparent) 0%, transparent 38%),
    var(--vex-bg, #0b0d10);
  color: var(--vex-text, #e5e7eb);
}

.vex-maint-card {
  width: 100%;
  max-width: 32rem;
  padding: 2rem;
  border-radius: 1rem;
  background: var(--vex-surface, #16191d);
  border: 1px solid var(--vex-border, #2a2f36);
  box-shadow: 0 24px 70px -28px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1rem;
}

.vex-maint-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border-radius: 9999px;
  padding: 0.45rem 0.8rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--vex-warning, #d97706) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--vex-warning, #d97706) 18%, transparent);
  color: var(--vex-warning, #d97706);
}

.vex-maint-title {
  font-family: var(--font-display, "Sora", system-ui, sans-serif);
  font-size: clamp(1.75rem, 4vw, 2.25rem);
  line-height: 1.08;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
  color: var(--vex-text, #e5e7eb);
}

.vex-maint-message {
  max-width: 28rem;
  font-size: 0.98rem;
  line-height: 1.65;
  color: var(--vex-text-faint, #9ca3af);
  margin: 0;
}

.vex-maint-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  min-height: 2.8rem;
  padding: 0.75rem 1.25rem;
  border-radius: 0.7rem;
  background: var(--vex-brand, #f59e0b);
  color: white;
  font-size: 0.875rem;
  font-weight: 700;
  border: 1px solid color-mix(in srgb, var(--vex-brand) 50%, transparent);
  cursor: pointer;
  box-shadow: 0 12px 30px -18px color-mix(in srgb, var(--vex-brand) 65%, transparent);
  transition: filter 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}

.vex-maint-button:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 18px 44px -18px color-mix(in srgb, var(--vex-brand) 72%, transparent);
}

.vex-maint-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.vex-maint-footnote {
  font-size: 0.875rem;
  color: var(--vex-text-muted, #9ca3af);
}

@media (max-width: 640px) {
  .vex-maint-screen {
    padding: 1rem;
  }

  .vex-maint-card {
    padding: 1.5rem 1.25rem;
  }

  .vex-maint-button {
    width: 100%;
  }
}
</style>
