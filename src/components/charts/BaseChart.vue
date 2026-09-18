<template>
  <div ref="containerRef" class="hf-chart" />
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { EChartsOption, EChartsType } from 'echarts'

const props = defineProps<{
  option: EChartsOption
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null

const render = () => {
  if (!chart) return
  chart.setOption(props.option, { notMerge: true })
}

watch(
  () => props.option,
  () => render(),
  { deep: true }
)

onMounted(async () => {
  await nextTick()
  if (!containerRef.value) return

  chart = echarts.init(containerRef.value)
  render()

  observer = new ResizeObserver(() => {
    chart?.resize()
  })
  observer.observe(containerRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.hf-chart {
  width: 100%;
  height: 100%;
  min-height: 220px;
}
</style>
