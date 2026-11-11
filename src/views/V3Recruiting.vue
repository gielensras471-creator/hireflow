<template>
  <section class="v3-recruiting">
    <header class="v3-page-heading">
      <div>
        <h1>{{ isDetail ? '申请详情' : positions ? '职位管理' : '候选人管理' }}</h1>
        <p>
          {{
            positions
              ? '维护职位信息，查看各职位的招聘申请'
              : '每条记录代表一次职位申请，阶段、生命周期和结果独立展示'
          }}
        </p>
      </div>
      <el-button
        v-if="!isDetail"
        type="primary"
        :disabled="loading || !!gate.current.value"
        @click="openEditor(null)"
        >＋ {{ positions ? '新建职位' : '添加申请' }}</el-button
      >
    </header>
    <form v-if="!isDetail" class="v3-card v3-filters" @submit.prevent="filter">
      <input
        v-model="search"
        aria-label="搜索"
        :placeholder="positions ? '搜索职位名称、部门' : '搜索姓名、负责人或职位'"
      />
      <select v-if="positions" v-model="status" aria-label="职位状态">
        <option value="">全部状态</option>
        <option value="open">开放</option>
        <option value="closed">关闭</option>
      </select>
      <template v-else>
        <input
          v-model="positionFilter"
          type="number"
          min="1"
          aria-label="职位 ID"
          placeholder="职位 ID"
        />
        <select v-model="stage" aria-label="阶段">
          <option value="">全部阶段</option>
          <option v-for="s in stages" :key="s" :value="s">{{ label(s) }}</option>
        </select>
        <select v-model="status" aria-label="申请状态">
          <option value="">全部申请状态</option>
          <option value="active">进行中</option>
          <option value="closed">已结束</option>
        </select>
      </template>
      <el-button native-type="submit">筛选</el-button
      ><el-button @click="clearFilters">清除筛选</el-button>
    </form>
    <V3RecruitingEditor
      v-if="editor"
      :key="editor.key"
      :positions="positions"
      :row="editor.row"
      :action="editor.action"
      :options="options"
      @close="closeProfile"
      @saved="saved"
    />
    <section
      v-if="loading && !positions && !isDetail"
      class="v3-card v3-application-loading"
      aria-busy="true"
      aria-labelledby="application-loading-title"
    >
      <h2 id="application-loading-title">申请记录</h2>
      <V3TableScroll name="职位与申请记录表格">
        <table aria-label="申请记录加载中">
          <thead>
            <tr>
              <th v-for="column in applicationColumns" :key="column" scope="col">{{ column }}</th>
            </tr>
          </thead>
          <tbody aria-hidden="true">
            <tr v-for="row in 5" :key="row" class="v3-loading-row">
              <td v-for="column in applicationColumns" :key="column">
                <span class="v3-loading-cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </V3TableScroll>
      <p role="status">加载记录中，请稍候…</p>
    </section>
    <V3Feedback
      v-else-if="loading"
      state="loading"
      :title="isDetail ? '读取详情中' : '加载记录中'"
    />
    <V3Feedback
      v-else-if="error"
      state="error"
      title="暂时无法查看记录"
      :message="error"
      action="重新加载"
      @action="load"
    />
    <section
      v-else-if="isDetail && selected"
      class="v3-card v3-detail-summary"
      aria-label="申请业务摘要"
    >
      <h2>{{ (selected as Application).name || '姓名未记录' }} · 申请 #{{ selected.id }}</h2>
      <p>
        {{ (selected as Application).positionTitle || '职位名称未记录' }} · 职位 #{{
          (selected as Application).positionId
        }}
      </p>
      <dl class="v3-detail-states">
        <dt>招聘阶段</dt>
        <dd>{{ label((selected as Application).stage) }}</dd>
        <dt>申请状态</dt>
        <dd>{{ label((selected as Application).applicationStatus) }}</dd>
        <dt>结束结果</dt>
        <dd>{{ applicationOutcomeText(selected as Application) }}</dd>
        <dt>Offer 状态</dt>
        <dd>{{ applicationOfferText(selected as Application) }}</dd>
      </dl>
      <ol class="v3-detail-stages" aria-label="招聘阶段位置，不代表事件历史">
        <li
          v-for="s in stages"
          :key="s"
          :aria-current="(selected as Application).stage === s ? 'step' : undefined"
        >
          {{ label(s) }}
        </li>
      </ol>
      <section class="v3-detail-task" aria-label="当前任务导览">
        <h3>当前任务</h3>
        <p v-if="(selected as Application).applicationStatus === 'closed'">
          本次申请已结束：{{ applicationOutcomeText(selected as Application) }}。结束原因：{{
            (selected as Application).closedReason || '未记录'
          }}。可查看历史及已有评价允许的有痕更正。
        </p>
        <p v-else>
          查看当前阶段操作与资格，以对应模块重新核实的服务器事实为准；此处不确认可写资格。
        </p>
        <el-button type="primary" @click="goToTask">查看当前阶段操作与资格</el-button>
      </section>
      <el-button
        :disabled="
          loading ||
          !!error ||
          refreshPending ||
          !!gate.current.value ||
          (selected as Application).applicationStatus !== 'active'
        "
        @click="openEditor(selected)"
        >编辑申请资料</el-button
      >
    </section>
    <V3Feedback
      v-else-if="!items.length"
      state="empty"
      :title="total > 0 ? '本页暂无记录' : filtered ? '没有匹配的记录' : '暂时没有记录'"
      :message="
        filtered
          ? '请调整筛选条件，或清除筛选。'
          : positions
            ? '新建职位后即可接收申请。'
            : '添加申请，开始跟进招聘进展。'
      "
      :action="offset > 0 ? '返回第一页' : filtered ? '清除筛选' : undefined"
      @action="
        offset > 0
          ? router.replace({ path: route.path, query: { ...route.query, offset: 0 } })
          : clearFilters()
      "
    />
    <section v-else class="v3-card">
      <h2>
        {{ positions ? '职位' : '申请' }}记录 <small>共 {{ total }} 条</small>
      </h2>
      <V3TableScroll name="职位与申请记录表格">
        <table aria-label="职位与申请记录">
          <thead>
            <tr>
              <th scope="col">{{ positions ? '职位 / 部门' : '候选人 / 申请' }}</th>
              <th scope="col">{{ positions ? '职位标识' : '应聘职位' }}</th>
              <th scope="col">{{ positions ? '状态' : '招聘阶段' }}</th>
              <th scope="col">{{ positions ? '申请总数' : '申请状态' }}</th>
              <th scope="col">{{ positions ? '活跃申请' : '招聘结果与 Offer' }}</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.id">
              <td>
                {{ positions ? (row as Position).title : (row as Application).name
                }}<small>{{ positions ? (row as Position).department : '#' + row.id }}</small>
              </td>
              <td>
                {{
                  positions
                    ? '#' + row.id
                    : (row as Application).positionTitle + ' · #' + (row as Application).positionId
                }}
              </td>
              <td>
                <span class="v3-state-label">{{
                  positions
                    ? (row as Position).deletedAt
                      ? '已归档'
                      : label((row as Position).status)
                    : label((row as Application).stage)
                }}</span>
              </td>
              <td>
                <span
                  class="v3-state-label"
                  :data-state="positions ? undefined : (row as Application).applicationStatus"
                  >{{
                    positions
                      ? (row as Position).applicationRecords
                      : label((row as Application).applicationStatus)
                  }}</span
                >
              </td>
              <td>
                <template v-if="positions">{{ (row as Position).activeApplications }}</template
                ><template v-else
                  ><span class="v3-state-label"
                    >结果：{{ applicationOutcomeText(row as Application) }}</span
                  ><small>Offer：{{ applicationOfferText(row as Application) }}</small></template
                >
              </td>
              <td>
                <el-button text @click="showDetail(row)">查看详情</el-button>
                <el-button
                  text
                  :disabled="
                    !!gate.current.value ||
                    (positions
                      ? !!(row as Position).deletedAt
                      : (row as Application).applicationStatus === 'closed')
                  "
                  @click="openEditor(row)"
                  >编辑</el-button
                >
                <template v-if="positions && !(row as Position).deletedAt">
                  <el-button
                    text
                    :disabled="!!gate.current.value"
                    @click="openEditor(row, 'status')"
                    >{{ (row as Position).status === 'open' ? '关闭' : '重新开放' }}</el-button
                  >
                  <el-button
                    text
                    :disabled="!!gate.current.value"
                    @click="openEditor(row, 'archive')"
                    >归档</el-button
                  >
                  <RouterLink :to="{ path: '/candidates', query: { positionId: row.id } }"
                    >查看申请</RouterLink
                  >
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </V3TableScroll>
      <div class="v3-pagination">
        <el-button :disabled="offset === 0" @click="page(-20)">上一页</el-button
        ><span>{{ offset + 1 }}–{{ Math.min(offset + 20, total) }} / {{ total }}</span
        ><el-button :disabled="offset + 20 >= total" @click="page(20)">下一页</el-button>
      </div>
    </section>
    <section v-if="positions && selected && !isDetail" class="v3-card">
      <h2>职位 #{{ selected.id }} 详情</h2>
      <dl class="v3-profile">
        <template v-for="[key, text] in positionFields" :key="key"
          ><dt>{{ text }}</dt>
          <dd>{{ display(selected, key) }}</dd></template
        >
      </dl>
      <el-button @click="selected = null">收起</el-button>
    </section>
    <p v-if="isDetail && selected && refreshPending" role="status">
      刷新已登记，当前编辑或请求结束后读取最新资料；草稿不会清除。
    </p>
    <p v-if="isDetail && selected && (loading || error)" role="status">
      以下为上次已核实资料，当前正在刷新或刷新失败，新的业务操作暂不可用。
    </p>
    <div v-if="isDetail && selected" class="v3-detail-grid">
      <section class="v3-detail-main" aria-label="招聘业务任务">
        <V3Interviews
          v-if="isDetail && selected"
          :key="selected.id"
          :refresh-token="detailRevision"
          :application-id="selected.id"
          data-detail-target="Interviews"
          :disabled="
            loading ||
            !!error ||
            refreshPending ||
            !!editor ||
            (gate.current.value !== null && gate.current.value === profileLease)
          "
          @updated="load"
        />
        <V3FeedbackPanel
          v-if="isDetail && selected"
          :key="'feedback-' + selected.id"
          :disabled="loading || !!error || refreshPending"
          :refresh-token="detailRevision"
          :application-id="selected.id"
          data-detail-target="FeedbackPanel"
          @updated="load"
        />
        <V3AdvancementPanel
          v-if="isDetail && selected"
          :key="'advance-' + selected.id"
          :disabled="loading || !!error || refreshPending"
          :refresh-token="detailRevision"
          :application-id="selected.id"
          data-detail-target="AdvancementPanel"
          @updated="load"
        />
        <V3OfferPanel
          v-if="isDetail && selected"
          :key="'offer-' + selected.id"
          :disabled="loading || !!error || refreshPending"
          :refresh-token="detailRevision"
          :application-id="selected.id"
          data-detail-target="OfferPanel"
          @updated="load"
        />
      </section>
      <aside class="v3-card v3-detail-aside" aria-label="申请资料">
        <h2>申请资料</h2>
        <dl class="v3-profile">
          <template v-for="[key, text] in applicationFields" :key="key"
            ><dt>{{ text }}</dt>
            <dd>{{ display(selected, key) }}</dd></template
          >
        </dl>
        <p>完整真实历史保留在各业务模块中，可使用原历史入口查看。</p>
      </aside>
    </div>
  </section>
</template>
<script setup lang="ts">
import { applicationOutcomeText, applicationOfferText } from '../api/recruiting-v3'
import V3TableScroll from '../components/V3TableScroll.vue'
import { computed, nextTick, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { readV3, v3Session } from '../api/request-v3'
import { latestRead } from '../api/v3-operation'
import {
  label,
  pageQuery,
  detail,
  positionFields,
  applicationFields,
  type Application,
  type Position,
  type RecruitingRow,
  type Page
} from '../api/recruiting-v3'
import V3Feedback from '../components/V3Feedback.vue'
import V3RecruitingEditor from '../components/V3RecruitingEditor.vue'
import V3Interviews from './V3Interviews.vue'
import V3OfferPanel from '../components/V3OfferPanel.vue'
import V3AdvancementPanel from '../components/V3AdvancementPanel.vue'
import V3FeedbackPanel from '../components/V3FeedbackPanel.vue'
import { createEditorGate, editorGateKey } from '../utils/v3-editor-gate'
import '../styles/v3-recruiting.scss'
const gate = createEditorGate()
provide(editorGateKey, gate)
let profileLease: symbol | null = null
let alive = true
const route = useRoute(),
  router = useRouter()
const positions = computed(() => route.path === '/positions')
const isDetail = computed(() => route.name === 'candidate-detail')
const resource = computed(() => (positions.value ? 'positions' : 'applications'))
const search = ref(''),
  status = ref(''),
  stage = ref(''),
  positionFilter = ref('')
const items = ref<RecruitingRow[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref('')
const refreshPending = ref(false),
  detailRevision = ref(0)
const selected = ref<RecruitingRow | null>(null),
  options = ref<Position[]>([])
const editor = ref<{
  row: RecruitingRow | null
  action: 'edit' | 'status' | 'archive'
  key: number
} | null>(null)
let editorKey = 0
let openingGeneration = 0
const query = latestRead(),
  selection = latestRead()
const offset = computed(() =>
  Number(new URLSearchParams(pageQuery(route.query, positions.value)).get('offset'))
)
const filtered = computed(() =>
  Object.keys(route.query).some((key) => key !== 'offset' && route.query[key])
)
const applicationColumns = [
  '候选人 / 申请',
  '应聘职位',
  '招聘阶段',
  '申请状态',
  '招聘结果与 Offer',
  '操作'
]
const stages = ['screening', 'first_interview', 'second_interview', 'offer']

function display(row: RecruitingRow, key: string) {
  const value = (row as unknown as Record<string, unknown>)[key]
  if (
    key === 'offerStatus' &&
    value === 'accepted' &&
    (row as Application).applicationStatus === 'closed'
  )
    return '已接受（Offer 最后事实）'
  return ['stage', 'applicationStatus', 'outcome', 'offerStatus'].includes(key)
    ? label(value as string)
    : value ?? '—'
}
function load() {
  if (!alive || v3Session.state.status !== 'ready') return
  if (isDetail.value && gate.current.value) {
    refreshPending.value = true
    return
  }
  refreshPending.value = false
  const path = route.fullPath,
    owner = v3Session.version()
  loading.value = true
  error.value = ''
  items.value = []
  if (!isDetail.value) selected.value = null
  return query.execute<RecruitingRow | Page<RecruitingRow>>(
    () =>
      isDetail.value
        ? detail('applications', Number(route.params.id))
        : readV3<Page<RecruitingRow>>(
            '/' + resource.value + '?' + pageQuery(route.query, positions.value)
          ),
    (data) => {
      if (!alive || path !== route.fullPath || owner !== v3Session.version()) return
      if ('items' in data) {
        items.value = data.items
        total.value = data.total
      } else selected.value = data
      loading.value = false
      if (isDetail.value) detailRevision.value++
    },
    (e) => {
      if (!alive || path !== route.fullPath || owner !== v3Session.version()) return
      error.value = e instanceof Error ? e.message : '读取失败'
      loading.value = false
    }
  )
}
function goToTask() {
  if (!selected.value) return
  const row = selected.value as Application
  const target =
    row.applicationStatus === 'closed'
      ? 'FeedbackPanel'
      : row.stage === 'offer'
        ? 'OfferPanel'
        : row.stage === 'screening'
          ? 'AdvancementPanel'
          : 'Interviews'
  const section = document.querySelector('[data-detail-target="' + target + '"]')
  section?.scrollIntoView({ block: 'start' })
  const heading = section?.querySelector<HTMLElement>('h2')
  heading?.setAttribute('tabindex', '-1')
  heading?.focus({ preventScroll: true })
}
function filter() {
  return router.push({
    path: route.path,
    query: {
      ...(search.value.trim() ? { q: search.value.trim() } : {}),
      ...(status.value ? { [positions.value ? 'status' : 'applicationStatus']: status.value } : {}),
      ...(!positions.value && stage.value ? { stage: stage.value } : {}),
      ...(!positions.value && positionFilter.value ? { positionId: positionFilter.value } : {})
    }
  })
}
function clearFilters() {
  return router.push({ path: route.path, query: {} })
}
function page(amount: number) {
  return router.push({ path: route.path, query: { ...route.query, offset: offset.value + amount } })
}
async function openEditor(
  row: RecruitingRow | null,
  action: 'edit' | 'status' | 'archive' = 'edit'
) {
  if (
    !alive ||
    loading.value ||
    !!error.value ||
    refreshPending.value ||
    gate.current.value ||
    v3Session.state.status !== 'ready'
  )
    return
  const lease = gate.acquire()
  if (!lease) return
  profileLease = lease
  const attempt = ++openingGeneration
  const path = route.fullPath
  const session = v3Session.version()
  try {
    const current = row ? await detail(resource.value, row.id) : null
    if (!positions.value && !row) options.value = await readV3<Position[]>('/positions/options')
    if (
      !alive ||
      !gate.owns(lease) ||
      attempt !== openingGeneration ||
      route.fullPath !== path ||
      v3Session.version() !== session ||
      v3Session.state.status !== 'ready'
    )
      return
    editor.value = { row: current, action, key: ++editorKey }
  } catch (e) {
    if (attempt === openingGeneration && route.fullPath === path && v3Session.version() === session)
      error.value = e instanceof Error ? e.message : '无法打开表单'
  } finally {
    if (!editor.value) {
      gate.release(lease)
      if (profileLease === lease) profileLease = null
    }
  }
}
async function closeProfile() {
  const lease = profileLease
  openingGeneration++
  editor.value = null
  await nextTick()
  if (lease) gate.release(lease)
  if (profileLease === lease) profileLease = null
}
function showDetail(row: RecruitingRow) {
  if (!positions.value) {
    void router.push('/candidates/' + row.id)
    return
  }
  void selection.execute(
    () => detail('positions', row.id),
    (data) => {
      selected.value = data
    },
    (e) => {
      error.value = e instanceof Error ? e.message : '读取失败'
    }
  )
}
function saved() {
  void closeProfile()
  void load()
}
watch(
  [() => route.fullPath, () => v3Session.state.user?.id],
  () => {
    query.invalidate()
    selection.invalidate()
    selected.value = null
    refreshPending.value = false
    void closeProfile()
    search.value = String(route.query.q ?? '')
    status.value = String(route.query[positions.value ? 'status' : 'applicationStatus'] ?? '')
    stage.value = String(route.query.stage ?? '')
    positionFilter.value = String(route.query.positionId ?? '')
    void load()
  },
  { immediate: true }
)
watch(
  [() => gate.current.value, () => v3Session.state.status],
  ([lease, status]) => {
    if (!lease && status === 'ready' && refreshPending.value) void load()
  },
  { flush: 'post' }
)
onUnmounted(() => {
  alive = false
  if (profileLease) gate.release(profileLease)
  openingGeneration++
  query.invalidate()
  selection.invalidate()
})
</script>
