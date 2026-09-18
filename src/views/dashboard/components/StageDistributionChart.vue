<template>
  <div class="chart-box">
    <BaseChart :option="option" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import BaseChart from '@/components/charts/BaseChart.vue'

import type { EChartsOption } from 'echarts'

interface StageChartItem {
  name: string
  value: number
}

const props = defineProps<{
  data: StageChartItem[]
}>()

const total = computed(() => {
  return props.data.reduce((sum, item) => sum + item.value, 0)
})

const option = computed<EChartsOption>(() => ({
  tooltip: {
    trigger: 'item',
    formatter: '{b}<br/>{c} 人 · {d}%'
  },

  legend: {
    bottom: 0,
    left: 'center',

    itemWidth: 9,
    itemHeight: 9,
    itemGap: 16,

    textStyle: {
      color: '#606266',
      fontSize: 12
    }
  },

  title: {
    text: String(total.value),

    subtext: '候选人',

    left: 'center',
    top: '34%',

    textStyle: {
      color: '#303133',
      fontSize: 26,
      fontWeight: 600
    },

    subtextStyle: {
      color: '#909399',
      fontSize: 12,
      lineHeight: 20
    }
  },

  series: [
    {
      name: '招聘阶段',
      type: 'pie',

      radius: ['55%', '76%'],

      center: ['50%', '43%'],

      avoidLabelOverlap: true,

      padAngle: 2,

      itemStyle: {
        borderColor: '#ffffff',
        borderWidth: 2,
        borderRadius: 4
      },

      label: {
        show: true,
        color: '#606266',
        fontSize: 12,

        formatter: '{b}\n{c} 人'
      },

      labelLine: {
        length: 10,
        length2: 8,

        lineStyle: {
          color: '#c0c4cc'
        }
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
