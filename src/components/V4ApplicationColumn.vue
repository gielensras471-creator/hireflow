<template>
  <section class="v4-stage" :data-stage="stage" :aria-labelledby="'v4-stage-' + stage">
    <header class="v4-stage-heading">
      <h2 :id="'v4-stage-' + stage">{{ label(stage) }}</h2>
      <span class="v4-stage-count" :aria-label="total === undefined ? '总数未确认' : undefined">{{
        total === undefined ? '—' : total + ' 条'
      }}</span>
      <button v-if="items.length && issue" class="v4-text-button" type="button" @click="reset">
        刷新本列
      </button>
    </header>
    <div
      ref="viewport"
      class="v4-stage-scroll"
      :aria-label="label(stage) + '申请列表'"
      role="region"
      tabindex="0"
      :data-loaded="offset"
    >
      <div class="v4-stage-cards" :class="{ 'v4-focus-cards': focus }">
        <V4ApplicationCard
          v-for="row in items"
          :key="row.id"
          :row="row"
          @open="(event, id) => $emit('open', event, id)"
        />
        <div
          v-for="placeholder in loading && !items.length ? 3 : 0"
          :key="'placeholder-' + placeholder"
          class="v4-application-skeleton"
          aria-hidden="true"
        >
          <span /><span /><span />
        </div>
      </div>
      <div
        ref="sentinel"
        class="v4-stage-status"
        :data-state="
          issue ? 'error' : loading ? 'loading' : total === 0 ? 'empty' : hasMore ? 'more' : 'end'
        "
      >
        <template v-if="issue">
          <p role="alert">{{ issue }}</p>
          <button class="v4-text-button" type="button" @click="inconsistent ? reset() : load()">
            重试
          </button>
        </template>
        <p v-else-if="loading" role="status">
          {{ items.length ? '正在载入更多申请…' : '正在读取申请…' }}
        </p>
        <p v-else-if="total === 0" role="status">{{ filtered ? '没有匹配的记录' : '暂无申请' }}</p>
        <p v-else-if="total !== undefined" role="status">
          {{
            hasMore
              ? '已载入 ' + items.length + ' / ' + total + ' 条'
              : '已加载全部 ' + total + ' 条'
          }}
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { readV3, v3Session } from '../api/request-v3'
import { label, type Application, type Page } from '../api/recruiting-v3'
import { listParams, verifyPage } from '../api/v4-recruiting-lists'
import { latestRead } from '../api/v3-operation'
import V4ApplicationCard from './V4ApplicationCard.vue'

const props = defineProps<{
  stage: string
  query: Record<string, unknown>
  queryKey: string
  enabled: boolean
  focus: boolean
  filtered: boolean
  restore?: { count: number; top: number }
}>()
const emit = defineEmits<{ open: [event: MouseEvent, id: number]; restored: [stage: string] }>()
const reads = latestRead()
const items = ref<Application[]>([])
const total = ref<number>()
const offset = ref(0)
const loading = ref(false)
const issue = ref('')
const inconsistent = ref(false)
const viewport = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | undefined
let pendingRestore: typeof props.restore
let revision = 0
const limit = 10
const hasMore = computed(() => total.value !== undefined && offset.value < total.value)

function reset() {
  revision++
  reads.invalidate()
  items.value = []
  total.value = undefined
  offset.value = 0
  issue.value = ''
  inconsistent.value = false
  loading.value = false
  pendingRestore = props.restore
  if (viewport.value) viewport.value.scrollTop = 0
  if (props.enabled) void load()
}

function load() {
  if (
    !props.enabled ||
    v3Session.state.status !== 'ready' ||
    loading.value ||
    (total.value !== undefined && !hasMore.value)
  )
    return
  const start = offset.value
  const attempt = revision
  loading.value = true
  issue.value = ''
  const params = listParams({ ...props.query, stage: props.stage }, false, limit, start)
  return reads.execute(
    () => readV3<Page<Application>>('/applications?' + params),
    (page) => {
      try {
        verifyPage(page, start, limit, total.value, items.value[items.value.length - 1]?.id)
        if (page.items.some((row) => row.stage !== props.stage))
          throw new Error('阶段数据不一致，请刷新本列。')
      } catch (error) {
        inconsistent.value = true
        loading.value = false
        issue.value = (error as Error).message
        return
      }
      items.value.push(...page.items)
      offset.value += page.items.length
      total.value = page.total
      loading.value = false
      void nextTick().then(() => {
        if (attempt !== revision) return
        if (offset.value < (pendingRestore?.count ?? 0) && hasMore.value) {
          void load()
          return
        }
        if (pendingRestore && viewport.value) {
          viewport.value.scrollTop = pendingRestore.top
          pendingRestore = undefined
          emit('restored', props.stage)
        }
        observe()
      })
    },
    (error: unknown) => {
      const element = viewport.value
      const nearBottom =
        element && element.scrollHeight - element.scrollTop - element.clientHeight < 60
      loading.value = false
      issue.value = error instanceof Error ? error.message : '暂时无法读取本列。'
      if (nearBottom && element)
        void nextTick().then(() => {
          if (attempt === revision) element.scrollTop = element.scrollHeight
        })
    }
  )
}

function observe() {
  observer?.disconnect()
  if (observer && sentinel.value && hasMore.value && !issue.value) observer.observe(sentinel.value)
}

watch(() => [props.queryKey, props.enabled], reset, { immediate: true })
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !issue.value) void load()
    },
    { root: viewport.value }
  )
  observe()
})
onUnmounted(() => {
  revision++
  reads.invalidate()
  observer?.disconnect()
})
</script>
