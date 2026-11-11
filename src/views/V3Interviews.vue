<template>
  <section class="v3-interviews">
    <header>
      <h1 v-if="!applicationId">面试管理</h1>
      <h2 v-else>面试活动</h2>
      <p>预约时间均为上海时间。到时仅提示，完成需要 HR 确认。</p>
      <el-button :disabled="props.disabled || loading || !!editor || opening" @click="load"
        >刷新面试记录</el-button
      >
    </header>
    <form v-if="!applicationId" class="v3-card v3-interview-filters" @submit.prevent="filter">
      <label
        >申请编号（ID）<input
          v-model="applicationFilter"
          type="number"
          min="1"
          aria-label="申请 ID"
          placeholder="输入申请编号（精确匹配）"
      /></label>
      <label
        >职位编号（ID）<input
          v-model="positionFilter"
          type="number"
          min="1"
          aria-label="职位 ID"
          placeholder="输入职位编号（精确匹配）"
      /></label>
      <select v-model="stage" aria-label="面试轮次">
        <option value="">全部轮次</option>
        <option value="first_interview">初面</option>
        <option value="second_interview">复面</option>
      </select>
      <select v-model="status" aria-label="面试状态">
        <option value="">全部状态</option>
        <option v-for="(text, key) in interviewStatus" :key="key" :value="key">{{ text }}</option>
      </select>
      <el-button type="primary" native-type="submit">筛选</el-button
      ><el-button @click="router.push('/interviews')">清除筛选</el-button>
      <p class="v3-filter-help">编号用于精确查找，不按姓名搜索。清除筛选可查看全部面试。</p>
    </form>
    <p v-if="!applicationId" class="v3-applied-filters" role="status">
      已应用：申请 {{ route.query.applicationId || '全部' }} · 职位
      {{ route.query.positionId || '全部' }} · 轮次
      {{ route.query.stageScope ? label(route.query.stageScope as string) : '全部' }} · 状态
      {{ interviewStatus[route.query.status as keyof typeof interviewStatus] || '全部' }}
    </p>
    <div v-if="applicationId && application" class="v3-card">
      <p>当前轮次 {{ label(application.stage) }} · {{ label(application.applicationStatus) }}</p>
      <el-button
        type="primary"
        :disabled="
          disabled ||
          loading ||
          !!error ||
          !fresh ||
          v3Session.state.status !== 'ready' ||
          !!gate.current.value ||
          !canSchedule(application, items)
        "
        @click="openEditor(null, 'schedule')"
        >安排面试</el-button
      >
      <p v-if="application.applicationStatus !== 'active'">申请已结束，不能安排或变更面试。</p>
      <p v-else-if="!['first_interview', 'second_interview'].includes(application.stage)">
        当前阶段不能安排面试。
      </p>
      <p v-else-if="items.some((row) => row.status === 'scheduled')">
        已有预约，需先完成或取消后再安排下一场。
      </p>
    </div>
    <V3InterviewEditor
      v-if="editor"
      :key="editor.key"
      :application="editor.application"
      :interview="editor.interview"
      :action="editor.action"
      @close="closeEditor"
      @saved="saved"
    />
    <p v-if="operationError" class="v3-error" role="alert">{{ operationError }}</p>
    <section
      v-if="loading && !applicationId"
      class="v3-card v3-interview-loading"
      aria-busy="true"
      aria-labelledby="interview-loading-title"
    >
      <h2 id="interview-loading-title">面试记录</h2>
      <V3TableScroll name="面试记录表格">
        <table aria-label="面试记录加载中">
          <thead>
            <tr>
              <th v-for="column in interviewColumns" :key="column" scope="col">{{ column }}</th>
            </tr>
          </thead>
          <tbody aria-hidden="true">
            <tr v-for="row in 5" :key="row" class="v3-interview-loading-row">
              <td v-for="column in interviewColumns" :key="column">
                <span class="v3-interview-loading-cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </V3TableScroll>
      <p role="status">加载面试记录中，请稍候…</p>
    </section>
    <V3Feedback v-else-if="loading" state="loading" title="加载面试记录中" />
    <V3Feedback
      v-else-if="error"
      state="error"
      title="暂时无法查看面试记录"
      :message="error"
      action="重新加载"
      @action="load"
    />
    <V3Feedback
      v-else-if="!items.length"
      :action="!applicationId && offset > 0 ? '返回第一页' : filtered ? '清除筛选' : undefined"
      state="empty"
      :title="total > 0 ? '本页暂无面试记录' : filtered ? '没有匹配的面试记录' : '暂时没有面试记录'"
      :message="
        applicationId
          ? '可从符合条件的当前轮次安排面试。'
          : '请调整筛选条件，或从申请详情安排面试。'
      "
      @action="
        router.push({ path: '/interviews', query: offset > 0 ? { ...route.query, offset: 0 } : {} })
      "
    />
    <section v-else class="v3-card">
      <h2>
        面试记录 <small>共 {{ total }} 场</small>
      </h2>
      <V3TableScroll name="面试记录表格">
        <table aria-label="面试记录">
          <thead>
            <tr>
              <th scope="col">面试 / 申请</th>
              <th scope="col">应聘职位</th>
              <th scope="col">轮次</th>
              <th scope="col">预约开始时间（上海）</th>
              <th scope="col">面试官</th>
              <th scope="col">状态</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in displayedInterviews" :key="row.id" :data-interview-id="row.id">
              <td>
                #{{ row.id
                }}<RouterLink :to="'/candidates/' + row.applicationId"
                  >{{ row.candidateName }} · 申请 #{{ row.applicationId }}</RouterLink
                >
              </td>
              <td>{{ row.positionTitle }} · #{{ row.positionId }}</td>
              <td>
                {{ label(row.stageScope)
                }}<small v-if="applicationId">{{
                  row.stageScope === application?.stage ? '当前轮' : '历史轮次'
                }}</small>
              </td>
              <td>
                {{ row.scheduledLocal.replace('T', ' ').replace('+08:00', '')
                }}<small>{{ row.businessTimeZone }}</small>
                <p
                  v-if="row.status === 'scheduled' && row.startTimeReached"
                  class="v3-reminder"
                  role="status"
                >
                  {{ row.reminder }}
                </p>
              </td>
              <td>{{ row.interviewerName }}</td>
              <td>
                <span class="v3-state-label" :data-state="row.status">{{
                  interviewStatus[row.status]
                }}</span
                ><small v-if="row.cancelReason">原因 {{ row.cancelReason }}</small>
              </td>
              <td>
                <el-button
                  v-for="action in actions"
                  :key="action"
                  text
                  :disabled="
                    disabled ||
                    row.status !== 'scheduled' ||
                    row.applicationStatus !== 'active' ||
                    !fresh ||
                    !!error ||
                    loading ||
                    v3Session.state.status !== 'ready' ||
                    !!gate.current.value ||
                    !!editor ||
                    opening
                  "
                  @click="openEditor(row, action)"
                  >{{ interviewAction[action] }}</el-button
                >
              </td>
            </tr>
          </tbody>
        </table>
      </V3TableScroll>
      <div v-if="!applicationId" class="v3-interview-actions">
        <el-button :disabled="offset === 0" @click="page(-20)">上一页</el-button
        ><span>{{ offset + 1 }}–{{ Math.min(offset + 20, total) }} / {{ total }}</span
        ><el-button :disabled="offset + 20 >= total" @click="page(20)">下一页</el-button>
      </div>
    </section>
  </section>
</template>
<script setup lang="ts">
import V3TableScroll from '../components/V3TableScroll.vue'
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { readV3, v3Session } from '../api/request-v3'
import { createEditorGate, editorGateKey } from '../utils/v3-editor-gate'
import { latestRead } from '../api/v3-operation'
import { label, type Application, type Page } from '../api/recruiting-v3'
import {
  canSchedule,
  interviewQuery,
  interviewStatus,
  interviewAction,
  type Interview,
  type InterviewAction
} from '../api/interview-v3'
import V3Feedback from '../components/V3Feedback.vue'
import V3InterviewEditor from '../components/V3InterviewEditor.vue'
import '../styles/v3-interviews.scss'
const props = defineProps<{ applicationId?: number; disabled?: boolean; refreshToken?: number }>()
const emit = defineEmits<{ editing: [boolean]; updated: [] }>()
const gate = inject(editorGateKey, null) ?? createEditorGate()
let lease: symbol | null = null
let alive = true
const fresh = ref(false)
const route = useRoute(),
  router = useRouter()
const items = ref<Interview[]>([]),
  application = ref<Application | null>(null),
  total = ref(0)
const displayedInterviews = computed(() => {
  if (!props.applicationId || !application.value) return items.value
  const stage = application.value.stage
  return [
    ...items.value.filter((row) => row.stageScope === stage),
    ...items.value.filter((row) => row.stageScope !== stage)
  ]
})
const loading = ref(false),
  error = ref(''),
  operationError = ref(''),
  opening = ref(false)
const applicationFilter = ref(''),
  positionFilter = ref(''),
  stage = ref(''),
  status = ref('')
const offset = computed(() =>
  Number(new URLSearchParams(interviewQuery(route.query)).get('offset'))
)
const filtered = computed(
  () =>
    !props.applicationId &&
    Object.keys(route.query).some((key) => key !== 'offset' && route.query[key])
)
const interviewColumns = [
  '面试 / 申请',
  '应聘职位',
  '轮次',
  '预约开始时间（上海）',
  '面试官',
  '状态',
  '操作'
]
const actions: Exclude<InterviewAction, 'schedule'>[] = ['reschedule', 'complete', 'cancel']
const editor = ref<{
  application: Application
  interview: Interview | null
  action: InterviewAction
  key: number
} | null>(null)
let generation = 0,
  editorKey = 0
const reads = latestRead()
function load() {
  if (editor.value || opening.value || props.disabled) return
  fresh.value = false
  application.value = null
  loading.value = true
  error.value = ''
  items.value = []
  return reads.execute(
    async () => {
      if (props.applicationId) {
        const [rows, app] = await Promise.all([
          readV3<Interview[]>('/applications/' + props.applicationId + '/interviews'),
          readV3<Application>('/applications/' + props.applicationId)
        ])
        return { items: rows, total: rows.length, app }
      }
      const page = await readV3<Page<Interview>>('/interviews?' + interviewQuery(route.query))
      return { ...page, app: null }
    },
    (result) => {
      fresh.value = true
      items.value = result.items
      total.value = result.total
      application.value = result.app
      loading.value = false
    },
    (e) => {
      error.value = e instanceof Error ? e.message : '读取失败'
      loading.value = false
    }
  )
}
async function openEditor(row: Interview | null, action: InterviewAction) {
  if (
    editor.value ||
    opening.value ||
    props.disabled ||
    !fresh.value ||
    loading.value ||
    error.value ||
    v3Session.state.status !== 'ready'
  )
    return
  const acquired = gate.acquire()
  if (!acquired) return
  lease = acquired
  const path = route.fullPath
  const attempt = ++generation,
    owner = v3Session.version()
  opening.value = true
  operationError.value = ''
  try {
    const id = row?.applicationId ?? props.applicationId!
    const [app, meeting, appointments] = await Promise.all([
      readV3<Application>('/applications/' + id),
      row ? readV3<Interview>('/interviews/' + row.id) : Promise.resolve(null),
      row
        ? Promise.resolve([] as Interview[])
        : readV3<Interview[]>('/applications/' + id + '/interviews')
    ])
    if (
      !alive ||
      !gate.owns(acquired) ||
      lease !== acquired ||
      props.disabled ||
      !fresh.value ||
      !!error.value ||
      route.fullPath !== path ||
      attempt !== generation ||
      owner !== v3Session.version() ||
      v3Session.state.status !== 'ready'
    )
      return
    if (
      app.applicationStatus !== 'active' ||
      (action === 'schedule' ? !canSchedule(app, appointments) : meeting?.status !== 'scheduled')
    )
      throw new Error('服务器当前状态不允许该面试操作，请刷新记录。')
    editor.value = { application: app, interview: meeting, action, key: ++editorKey }
    emit('editing', true)
  } catch (e) {
    if (alive && attempt === generation && owner === v3Session.version() && route.fullPath === path)
      operationError.value = e instanceof Error ? e.message : '无法打开操作'
  } finally {
    if (attempt === generation) opening.value = false
    if (!editor.value) {
      gate.release(acquired)
      if (lease === acquired) lease = null
    }
  }
}
async function closeEditor() {
  const releasing = lease
  generation++
  opening.value = false
  editor.value = null
  emit('editing', false)
  await nextTick()
  if (releasing) gate.release(releasing)
  if (lease === releasing) lease = null
}
function saved() {
  closeEditor()
  void load()
  emit('updated')
}
function filter() {
  const query: Record<string, string> = {}
  for (const [key, value] of [
    ['applicationId', applicationFilter.value],
    ['positionId', positionFilter.value],
    ['stageScope', stage.value],
    ['status', status.value]
  ])
    if (value) query[key] = value
  void router.push({ path: '/interviews', query })
}
function page(amount: number) {
  void router.push({
    path: '/interviews',
    query: { ...route.query, offset: offset.value + amount }
  })
}
watch(
  () => [props.applicationId, route.fullPath],
  () => {
    generation++
    reads.invalidate()
    closeEditor()
    applicationFilter.value = String(route.query.applicationId ?? '')
    positionFilter.value = String(route.query.positionId ?? '')
    stage.value = String(route.query.stageScope ?? '')
    status.value = String(route.query.status ?? '')
    void load()
  },
  { immediate: true }
)
const refreshTimer = window.setInterval(() => {
  if (
    !loading.value &&
    !editor.value &&
    !opening.value &&
    !props.disabled &&
    !gate.current.value &&
    v3Session.state.status === 'ready' &&
    document.visibilityState === 'visible'
  )
    void load()
}, 30000)
watch(
  () => props.refreshToken,
  () => {
    if (!props.disabled && !gate.current.value) void load()
  }
)
onUnmounted(() => {
  alive = false
  if (lease) gate.release(lease)
  window.clearInterval(refreshTimer)
  generation++
  reads.invalidate()
  emit('editing', false)
})
</script>
