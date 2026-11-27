<template>
  <el-popover
    v-if="!row.deletedAt"
    v-model:visible="visible"
    placement="bottom-end"
    trigger="click"
    role="dialog"
    aria-label="职位操作"
    :width="176"
    :teleported="true"
    @after-enter="focusMenu"
  >
    <template #reference>
      <button
        ref="trigger"
        class="v4-more-button"
        type="button"
        :aria-label="'职位 #' + row.id + ' 的更多操作'"
        :aria-expanded="visible"
        @click="rememberTrigger"
        @keydown.esc.prevent.stop="closeMenu"
      >
        ···
      </button>
    </template>
    <div
      ref="actions"
      class="v4-position-menu"
      aria-label="职位操作"
      @keydown.esc.prevent.stop="closeMenu"
    >
      <button type="button" :disabled="disabled" @click="choose($event, 'edit')">编辑</button>
      <button type="button" :disabled="disabled" @click="choose($event, 'status')">
        {{ row.status === 'open' ? '关闭' : '重新开放' }}
      </button>
      <RouterLink :to="{ path: '/candidates', query: { positionId: row.id } }">查看申请</RouterLink>
      <button
        class="v4-menu-danger"
        type="button"
        :disabled="disabled"
        @click="choose($event, 'archive')"
      >
        归档
      </button>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { Position } from '../api/recruiting-v3'

defineProps<{ row: Position; disabled: boolean }>()
type Action = 'edit' | 'status' | 'archive'
const emit = defineEmits<{ action: [event: MouseEvent, action: Action, opener?: HTMLElement] }>()
const visible = ref(false)
const trigger = ref<HTMLElement>()
const actions = ref<HTMLElement>()

function rememberTrigger(event: MouseEvent) {
  if (event.currentTarget instanceof HTMLElement) trigger.value = event.currentTarget
}

function closeMenu() {
  visible.value = false
  trigger.value?.focus()
}

async function focusMenu() {
  await nextTick()
  if (visible.value) actions.value?.querySelector<HTMLElement>('button:not(:disabled), a')?.focus()
}

function choose(event: MouseEvent, action: Action) {
  closeMenu()
  emit('action', event, action, trigger.value)
}
</script>

<style scoped>
.v4-position-menu {
  display: grid;
  gap: 3px;
}
.v4-position-menu :is(button, a) {
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: white;
  color: #19181c;
  font: inherit;
  text-align: left;
  text-decoration: none;
}
.v4-position-menu :is(button, a):is(:hover, :focus-visible) {
  background: #f3ebfa;
  color: #612cd3;
}
.v4-position-menu .v4-menu-danger {
  color: #9b3043;
}
.v4-position-menu button:disabled {
  color: #76717c;
  cursor: not-allowed;
}
</style>
