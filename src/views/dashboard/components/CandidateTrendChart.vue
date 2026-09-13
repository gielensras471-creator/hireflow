<template>
  <div class="chart-box">
    <ECharts :option="option" :resize="true" />
  </div>
</template>

<script setup lang="ts">
import ECharts from '@/components/ECharts/index.vue'
import { ECOption } from '@/components/ECharts/config'

const data = {
  columns: getDates(),
  values: [12, 18, 15, 24, 20, 31, 26]
}

function getDates() {
  const dates: string[] = []

  for (let i = 6; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)

    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    dates.push(`${month}-${day}`)
  }

  return dates
}

const option: ECOption = {
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
    data: data.columns,
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
      data: data.values,
      areaStyle: {},
      lineStyle: {
        width: 3
      }
    }
  ]
}
</script>

<style scoped lang="scss">
.chart-box {
  width: 100%;
  height: 100%;
}
</style>
