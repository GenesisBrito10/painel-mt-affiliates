<script setup lang="ts">
const props = defineProps({
  password: { type: String, default: '' }
})

const strength = computed(() => {
  const p = props.password
  if (!p) return { score: 0, label: '', color: 'bg-slate-200 dark:bg-slate-700' }
  
  let s = 0
  if (p.length >= 6) s += 1
  if (p.length >= 8) s += 1
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s += 1
  if (/[0-9]/.test(p)) s += 1
  if (/[^A-Za-z0-9]/.test(p)) s += 1
  
  if (s <= 2) return { score: 1, label: 'Fraca', color: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' }
  if (s <= 3) return { score: 2, label: 'Razoável', color: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
  return { score: 3, label: 'Forte', color: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
})
</script>

<template>
  <div class="mt-2" v-if="password">
    <div class="flex gap-1.5 mb-1.5 h-1.5">
      <div v-for="i in 3" :key="i" class="h-full flex-1 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div class="h-full w-full transition-all duration-300" :class="i <= strength.score ? strength.color : 'bg-transparent'" />
      </div>
    </div>
    <div class="flex justify-end">
      <p class="text-[10px] font-bold uppercase tracking-wider transition-colors duration-300" :class="strength.text">
        {{ strength.label }}
      </p>
    </div>
  </div>
</template>
