<template>
  <template v-for="subItem in menuList" :key="subItem.path">
    <el-sub-menu v-if="subItem.children?.length" :index="subItem.path">
      <template #title>
        <i
          v-if="subItem.meta.icon"
          class="menu-icon iconfont"
          :class="'icon-' + subItem.meta.icon"
        ></i>

        <span v-else class="menu-dot"></span>

        <span class="sle">
          {{ subItem.meta.title }}
        </span>
      </template>

      <SubMenu :menu-list="subItem.children" />
    </el-sub-menu>

    <el-menu-item v-else :index="subItem.path" @click="handleClickMenu(subItem)">
      <i
        v-if="subItem.meta.icon"
        class="menu-icon iconfont"
        :class="'icon-' + subItem.meta.icon"
      ></i>

      <span v-else class="menu-dot"></span>

      <template #title>
        <span class="sle">
          {{ subItem.meta.title }}
        </span>
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
  margin-right: 10px;
  font-size: 17px;
  text-align: center;
}

.menu-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-right: 12px;
  background: currentColor;
  border-radius: 50%;
  opacity: 0.42;
}

.el-menu-item {
  position: relative;
  height: 44px;
  margin: 4px 10px;
  color: var(--el-text-color-regular);
  line-height: 44px;
  border-radius: 10px;
  transition:
    color 0.2s ease,
    background 0.2s ease;

  &:hover {
    color: var(--el-color-primary);
    background: var(--el-fill-color-light);
  }

  &.is-active {
    color: var(--el-color-primary);
    font-weight: 600;
    background: var(--el-color-primary-light-9);

    .menu-dot {
      opacity: 1;
    }

    &::after {
      position: absolute;
      top: 12px;
      right: 6px;
      width: 3px;
      height: 20px;
      content: '';
      background: var(--el-color-primary);
      border-radius: 3px;
    }
  }
}

:deep(.el-sub-menu__title) {
  height: 44px;
  margin: 4px 10px;
  color: var(--el-text-color-regular);
  line-height: 44px;
  border-radius: 10px;

  &:hover {
    color: var(--el-color-primary);
    background: var(--el-fill-color-light);
  }
}
</style>
