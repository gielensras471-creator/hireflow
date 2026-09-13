<template>
  <el-breadcrumb separator="/">
    <el-breadcrumb-item
      v-for="item in breadcrumbList"
      :key="item.path"
      :to="{ path: item.path }"
    >
      {{ item.title }}
    </el-breadcrumb-item>
  </el-breadcrumb>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { HOME_URL } from '@/config'

const route = useRoute()

interface BreadcrumbItem {
  path: string
  title: string
}

const breadcrumbList = computed<BreadcrumbItem[]>(() => {
  const list: BreadcrumbItem[] = route.matched
    .filter((item) => item.meta?.title)
    .map((item) => ({
      path: item.path,
      title: item.meta.title as string
    }))

  // 当前不是 Dashboard 时，在最前面补一个“工作台”
  if (route.path !== HOME_URL) {
    list.unshift({
      path: HOME_URL,
      title: '工作台'
    })
  }

  return list
})
</script>

<style scoped lang="scss"></style>