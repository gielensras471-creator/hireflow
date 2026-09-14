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
    trigger: 'axis',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: '#e5e7eb',
    borderWidth: 1,
    textStyle: {
      color: '#303133'
    }
  },

  grid: {
    top: 20,
    left: 8,
    right: 18,
    bottom: 8,
    containLabel: true
  },

  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: props.labels,

    axisTick: {
      show: false
    },

    axisLine: {
      lineStyle: {
        color: '#e5e7eb'
      }
    },

    axisLabel: {
      color: '#909399',
      fontSize: 12
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

    axisLabel: {
      color: '#909399',
      fontSize: 12
    },

    splitLine: {
      lineStyle: {
        color: '#eef0f4',
        type: 'dashed'
      }
    }
  },

  series: [
    {
      name: '新增候选人',
      type: 'line',

      /*
       * 每日人数属于离散数据，
       * 不使用过度平滑曲线，
       * 防止 0 / 1 数据产生视觉误导。
       */
      smooth: false,

      symbol: 'circle',
      symbolSize: 7,

      showSymbol: true,

      data: props.values,

      lineStyle: {
        width: 2.5,
        color: '#2254F4'
      },

      itemStyle: {
        color: '#2254F4',
        borderColor: '#ffffff',
        borderWidth: 2
      },

      /*
       * 保留非常轻的面积层，
       * 不再出现原来的“大蓝块”。
       */
      areaStyle: {
        color: 'rgba(34, 84, 244, 0.06)'
      },

      emphasis: {
        scale: true
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
