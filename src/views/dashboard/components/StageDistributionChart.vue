<template>
  <div class="chart-box">
    <ECharts :option="option" :resize="true" />
  </div>
</template>

<script setup lang="ts">
import ECharts from '@/components/ECharts/index.vue'
import { ECOption } from '@/components/ECharts/config'

const option: ECOption = {
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

      data: [
        {
          value: 42,
          name: '筛选'
        },
        {
          value: 31,
          name: '初面'
        },
        {
          value: 18,
          name: '复面'
        },
        {
          value: 11,
          name: 'Offer'
        },
        {
          value: 24,
          name: '淘汰'
        }
      ]
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
