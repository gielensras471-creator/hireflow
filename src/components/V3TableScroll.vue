<template>
  <div class="v3-table-region">
    <p v-if="overflow" class="v3-table-hint" role="note">{{ hint }}</p>
    <div
      ref="viewport"
      class="v3-table-scroll"
      role="region"
      :aria-label="name"
      :aria-description="overflow ? hint : undefined"
      :tabindex="overflow ? 0 : undefined"
      @scroll.passive="measure"
      @keydown="scrollKey"
    >
      <slot />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, onUpdated, ref } from 'vue'
defineProps<{ name: string }>()
const viewport = ref<HTMLElement | null>(null)
const overflow = ref(false),
  left = ref(false),
  right = ref(false)
const hint = computed(() =>
  right.value
    ? left.value
      ? '可左右滑动查看完整表格及操作；键盘可用左右方向键。'
      : '向右滑动查看完整表格及操作；键盘可用右方向键。'
    : '已到右端，可向左滑动查看前面的列；键盘可用左方向键。'
)
let observer: ResizeObserver | undefined
let table: Element | null = null
let alive = true
function measure() {
  const el = viewport.value
  if (!alive || !el) return
  overflow.value = el.scrollWidth > el.clientWidth + 1
  left.value = el.scrollLeft > 1
  right.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}
function observeTable() {
  const next = viewport.value?.querySelector('table') ?? null
  if (next !== table) {
    if (table) observer?.unobserve(table)
    table = next
    if (table) observer?.observe(table)
  }
  measure()
}
function scrollKey(event: KeyboardEvent) {
  if (
    event.target !== viewport.value ||
    !overflow.value ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  event.preventDefault()
  viewport.value!.scrollLeft += event.key === 'ArrowRight' ? 80 : -80
  measure()
}
onMounted(() => {
  observer = new ResizeObserver(measure)
  if (viewport.value) observer.observe(viewport.value)
  observeTable()
})
onUpdated(() => {
  void nextTick(observeTable)
})
onUnmounted(() => {
  alive = false
  observer?.disconnect()
  table = null
})
</script>
<style scoped>
.v3-table-region {
  min-width: 0;
  max-width: 100%;
}
.v3-table-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--v3-muted);
}
.v3-table-scroll {
  max-width: 100%;
  overflow-x: auto;
}
.v3-table-scroll:focus-visible {
  outline: 2px solid var(--v3-brand);
  outline-offset: 2px;
}
</style>
