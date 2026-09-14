<template>
  <div class="chart-box">
    <ECharts :option="option" :resize="true" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import ECharts from '@/components/ECharts/index.vue'

import type { ECOption } from '@/components/ECharts/config'

const props = defineProps<{
  labels: string[]
  values: number[]
}>()

const option = computed<ECOption>(() => ({
  tooltip: {
    trigger: 'axis'
  },

  grid: {
    top: '12%',
    left: '3%',
    right: '3%',
    bottom: '4%',
    containLabel: true
  },

  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: props.labels,

    axisTick: {
      show: false
    }
  },

  yAxis: {
    type: 'value',
    minInterval: 1,

    axisLine: {
      show: false
    },

    axisTick: {
      show: false
    },

    splitLine: {
      show: true
    }
  },

  series: [
    {
      name: '新增候选人',
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 7,
      data: props.values,

      areaStyle: {},

      lineStyle: {
        width: 3
      }
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
