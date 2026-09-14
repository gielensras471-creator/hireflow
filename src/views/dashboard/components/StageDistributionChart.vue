<template>
  <div class="chart-box">
    <ECharts :option="option" :resize="true" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import ECharts from '@/components/ECharts/index.vue'

import type { ECOption } from '@/components/ECharts/config'

interface StageChartItem {
  name: string
  value: number
}

const props = defineProps<{
  data: StageChartItem[]
}>()

const option = computed<ECOption>(() => ({
  tooltip: {
    trigger: 'item',
    formatter: '{b}: {c} 人 ({d}%)'
  },

  legend: {
    bottom: '2%',
    left: 'center'
  },

  series: [
    {
      name: '招聘阶段',
      type: 'pie',

      radius: ['48%', '70%'],

      center: ['50%', '43%'],

      avoidLabelOverlap: true,

      itemStyle: {
        borderWidth: 2
      },

      label: {
        show: true,
        formatter: '{b}\n{c} 人'
      },

      data: props.data
    }
  ]
}))
</script>

<style scoped lang="scss">
.chart-box {
  width: 100%;
  height: 100%;
}
</style>
