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
        :disabled="loading || !!editor"
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
      @close="editor = null"
      @saved="saved"
    />
    <section
      v-if="loading && !positions && !isDetail"
      class="v3-card v3-application-loading"
      aria-busy="true"
      aria-labelledby="application-loading-title"
    >
      <h2 id="application-loading-title">申请记录</h2>
      <div class="v3-table-scroll">
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
      </div>
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
    <section v-else-if="isDetail && selected" class="v3-card">
      <h2>{{ (selected as Application).name }} · 申请 #{{ selected.id }}</h2>
      <dl class="v3-profile">
        <template v-for="[key, text] in detailFields" :key="key"
          ><dt>{{ text }}</dt>
          <dd>{{ display(selected, key) }}</dd></template
        >
      </dl>
      <p>面试、评价、晋级、结案与 Offer 操作将在后续批次接入。</p>
      <el-button
        :disabled="(selected as Application).applicationStatus !== 'active'"
        @click="openEditor(selected)"
        >编辑申请资料</el-button
      >
    </section>
    <V3Feedback
      v-else-if="!items.length"
      state="empty"
      :title="total > 0 ? '本页暂无记录' : filtered ? '没有匹配的记录' : '暂时没有记录'"
      :message="filtered ? '请调整筛选条件，或清除筛选。' : '可以添加第一条真实业务记录。'"
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
      <div class="v3-table-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ positions ? '职位 / 部门' : '候选人 / 申请' }}</th>
              <th>{{ positions ? '职位标识' : '应聘职位' }}</th>
              <th>{{ positions ? '状态' : '招聘阶段' }}</th>
              <th>{{ positions ? '申请总数' : '申请状态' }}</th>
              <th>{{ positions ? '活跃申请' : '结果 / Offer' }}</th>
              <th>操作</th>
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
                {{
                  positions
                    ? (row as Position).deletedAt
                      ? '已归档'
                      : label((row as Position).status)
                    : label((row as Application).stage)
                }}
              </td>
              <td>
                {{
                  positions
                    ? (row as Position).applicationRecords
                    : label((row as Application).applicationStatus)
                }}
              </td>
              <td>
                {{
                  positions
                    ? (row as Position).activeApplications
                    : label((row as Application).outcome) +
                      ' / ' +
                      label((row as Application).offerStatus)
                }}
              </td>
              <td>
                <el-button text @click="showDetail(row)">查看详情</el-button>
                <el-button
                  text
                  :disabled="
                    !!editor ||
                    (positions
                      ? !!(row as Position).deletedAt
                      : (row as Application).applicationStatus === 'closed')
                  "
                  @click="openEditor(row)"
                  >编辑</el-button
                >
                <template v-if="positions && !(row as Position).deletedAt">
                  <el-button text :disabled="!!editor" @click="openEditor(row, 'status')">{{
                    (row as Position).status === 'open' ? '关闭' : '重新开放'
                  }}</el-button>
                  <el-button text :disabled="!!editor" @click="openEditor(row, 'archive')"
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
      </div>
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
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
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
import { confirmV3Leave } from '../router/v3-drafts'
import '../styles/v3-recruiting.scss'
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
  '结果 / Offer',
  '操作'
]
const stages = ['screening', 'first_interview', 'second_interview', 'offer']
const detailFields = [
  ['positionTitle', '应聘职位'],
  ['positionId', '职位 ID'],
  ['stage', '招聘阶段'],
  ['applicationStatus', '申请状态'],
  ['outcome', '结束结果'],
  ['offerStatus', 'Offer 状态'],
  ...applicationFields,
  ['closedReason', '结束原因'],
  ['version', '版本']
]
function display(row: RecruitingRow, key: string) {
  const value = (row as unknown as Record<string, unknown>)[key]
  return ['stage', 'applicationStatus', 'outcome', 'offerStatus'].includes(key)
    ? label(value as string)
    : value ?? '—'
}
function load() {
  loading.value = true
  error.value = ''
  items.value = []
  selected.value = null
  return query.execute<RecruitingRow | Page<RecruitingRow>>(
    () =>
      isDetail.value
        ? detail('applications', Number(route.params.id))
        : readV3<Page<RecruitingRow>>(
            '/' + resource.value + '?' + pageQuery(route.query, positions.value)
          ),
    (data) => {
      if ('items' in data) {
        items.value = data.items
        total.value = data.total
      } else selected.value = data
      loading.value = false
    },
    (e) => {
      error.value = e instanceof Error ? e.message : '读取失败'
      loading.value = false
    }
  )
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
  if (editor.value && !confirmV3Leave()) return
  const attempt = ++openingGeneration
  const path = route.fullPath
  const session = v3Session.version()
  try {
    const current = row ? await detail(resource.value, row.id) : null
    if (!positions.value && !row) options.value = await readV3<Position[]>('/positions/options')
    if (attempt !== openingGeneration || route.fullPath !== path || v3Session.version() !== session)
      return
    editor.value = { row: current, action, key: ++editorKey }
  } catch (e) {
    if (attempt === openingGeneration && route.fullPath === path && v3Session.version() === session)
      error.value = e instanceof Error ? e.message : '无法打开表单'
  }
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
  editor.value = null
  void load()
}
watch(
  () => route.fullPath,
  () => {
    query.invalidate()
    selection.invalidate()
    editor.value = null
    search.value = String(route.query.q ?? '')
    status.value = String(route.query[positions.value ? 'status' : 'applicationStatus'] ?? '')
    stage.value = String(route.query.stage ?? '')
    positionFilter.value = String(route.query.positionId ?? '')
    void load()
  },
  { immediate: true }
)
onUnmounted(() => {
  openingGeneration++
  query.invalidate()
  selection.invalidate()
})
</script>
