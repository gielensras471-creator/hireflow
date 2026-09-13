<template>
  <template v-for="subItem in menuList" :key="subItem.path">
    <el-sub-menu v-if="subItem.children?.length" :index="subItem.path">
      <template #title>
        <i
          v-if="subItem.meta.icon"
          class="menu-icon iconfont"
          :class="'icon-' + subItem.meta.icon"
        ></i>
        <span class="sle">{{ subItem.meta.title }}</span>
      </template>

      <SubMenu :menu-list="subItem.children" />
    </el-sub-menu>

    <el-menu-item v-else :index="subItem.path" @click="handleClickMenu(subItem)">
      <i
        v-if="subItem.meta.icon"
        class="menu-icon iconfont"
        :class="'icon-' + subItem.meta.icon"
      ></i>

      <template #title>
        <span class="sle">{{ subItem.meta.title }}</span>
      </template>
    </el-menu-item>
  </template>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { AppMenuItem } from '@/types/navigation'

defineProps<{
  menuList: AppMenuItem[]
}>()

const router = useRouter()

const handleClickMenu = (subItem: AppMenuItem) => {
  if (subItem.meta.isLink) {
    return window.open(subItem.path, '_blank')
  }

  router.push(subItem.path)
}
</script>

<style scoped lang="scss">
.menu-icon {
  margin-right: 5px;
  font-size: 18px;
  text-align: center;
  vertical-align: middle;
}

.el-menu-item.is-active {
  color: #ffffff;
  background-color: var(--el-color-primary);
}
</style>
