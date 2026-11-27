<template>
  <section class="v4-position-detail">
    <RouterLink class="position-text-link" :to="source">‹ 返回来源页面</RouterLink>
    <h1 v-if="!position">职位详情</h1>
    <V3Feedback v-if="loading && !position" state="loading" title="正在读取职位详情" />
    <V3Feedback
      v-else-if="problem"
      state="error"
      :title="problem"
      action="重新读取职位详情"
      @action="load"
    />
    <template v-else-if="position">
      <header class="position-heading">
        <div>
          <div class="position-title">
            <V4JobGlyph />
            <h1>{{ position.title }}</h1>
            <span class="position-status" :data-state="position.status">{{ statusText }}</span>
            <span v-if="position.deletedAt !== null" class="position-status">已归档</span>
            <small>职位 #{{ position.id }}</small>
          </div>
          <p>
            {{ position.department || '部门未填写' }} · {{ position.location || '地点未填写' }} ·
            发布于 {{ position.publishDate || '未填写' }}
          </p>
        </div>
        <div class="position-actions">
          <RouterLink class="position-accent" :to="applicationsTarget">查看关联申请</RouterLink>
          <button
            v-if="position.deletedAt === null"
            class="position-primary"
            type="button"
            @click="openEditor"
          >
            编辑职位
          </button>
        </div>
      </header>
      <V3RecruitingEditor
        v-if="editing"
        positions
        :row="position"
        action="edit"
        :options="[]"
        @vue:mounted="editorFocus.enter"
        @close="closeEditor"
        @saved="saved"
      />
      <section class="position-panel">
        <h2>招聘概况</h2>
        <dl class="position-metrics">
          <div>
            <dt>累计申请记录 · 条</dt>
            <dd>{{ position.applicationRecords }}</dd>
          </div>
          <div>
            <dt>活跃申请记录 · 条</dt>
            <dd>{{ position.activeApplications }}</dd>
          </div>
          <div>
            <dt>已完成面试 · 场</dt>
            <dd>{{ completed === undefined ? '读取中…' : completed ?? '不可用' }}</dd>
            <button
              v-if="completed === null"
              class="position-text-link"
              type="button"
              @click="loadCompleted"
            >
              重试场次
            </button>
          </div>
        </dl>
      </section>
      <div class="position-info-grid">
        <section class="position-panel">
          <h2>职位描述</h2>
          <p class="position-description">{{ position.description || '暂无职位说明。' }}</p>
        </section>
        <section class="position-panel">
          <h2>职位基本信息</h2>
          <dl class="position-facts">
            <div>
              <dt>职位编号</dt>
              <dd>#{{ position.id }}</dd>
            </div>
            <div>
              <dt>部门</dt>
              <dd>{{ position.department || '未填写' }}</dd>
            </div>
            <div>
              <dt>工作地点</dt>
              <dd>{{ position.location || '未填写' }}</dd>
            </div>
            <div>
              <dt>发布日期</dt>
              <dd>{{ position.publishDate || '未填写' }}</dd>
            </div>
            <div>
              <dt>招聘状态</dt>
              <dd>{{ statusText }}</dd>
            </div>
            <div>
              <dt>归档状态</dt>
              <dd>{{ position.deletedAt === null ? '未归档' : '已归档' }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <section class="position-panel">
        <header class="position-preview-heading">
          <div>
            <h2>关联候选人申请</h2>
            <p>按职位 ID 关联，每条记录代表一次职位申请。</p>
          </div>
          <RouterLink class="position-text-link" :to="applicationsTarget"
            >查看全部申请 ›</RouterLink
          >
        </header>
        <p v-if="previewLoading" role="status">正在读取关联申请…</p>
        <V3Feedback
          v-else-if="previewIssue"
          state="error"
          title="无法读取关联申请"
          action="重试关联申请"
          @action="loadApplications"
        />
        <V3Feedback v-else-if="!applications.length" state="empty" title="暂无关联申请" />
        <V3TableScroll v-else name="关联候选人申请">
          <table>
            <thead>
              <tr>
                <th v-for="heading in columns" :key="heading" scope="col">{{ heading }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in applications" :key="row.id">
                <td>{{ row.name }}</td>
                <td>#{{ row.id }}</td>
                <td>{{ label(row.stage) }}</td>
                <td>
                  {{ label(row.applicationStatus)
                  }}<span v-if="row.applicationStatus === 'closed'">
                    · {{ applicationOutcomeText(row) }}</span
                  ><span v-if="row.stage === 'offer'"> · {{ applicationOfferText(row) }}</span>
                </td>
                <td>{{ row.appliedDate || '—' }}</td>
                <td>
                  <RouterLink
                    class="position-text-link"
                    :to="{
                      name: 'candidate-detail',
                      params: { id: row.id },
                      query: { fromPosition: route.fullPath }
                    }"
                    >查看详情 ›</RouterLink
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </V3TableScroll>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import V4JobGlyph from '../components/V4JobGlyph.vue'
import V3Feedback from '../components/V3Feedback.vue'
import V3RecruitingEditor from '../components/V3RecruitingEditor.vue'
import V3TableScroll from '../components/V3TableScroll.vue'
import { readV3, v3Session } from '../api/request-v3'
import { latestRead } from '../api/v3-operation'
import {
  label,
  applicationOutcomeText,
  applicationOfferText,
  type Position,
  type Application,
  type Page
} from '../api/recruiting-v3'
import { useEditorFocus } from '../utils/v3-editor-focus'
import { V3Error } from '../utils/auth-v3'
import { positionTabTitle } from '../router/v4-position-navigation'
import { positionSource } from '../router/v3-navigation'
import '../styles/v4-position-detail.scss'

const route = useRoute()
const source = computed(() => positionSource(route.query.from))
const applicationsTarget = computed(() => ({
  name: 'candidates',
  query: { positionId: String(route.params.id), applicationStatus: 'all' }
}))
const titleTab = inject(positionTabTitle)
const position = ref<Position | null>(null)
const statusText = computed(() => (position.value?.status === 'open' ? '招聘中' : '已关闭'))
const columns = ['候选人', '申请 ID', '当前阶段', '生命周期／结果', '申请日期', '操作']
const problem = ref('')
const loading = ref(false)
const applications = ref<Application[]>([])
const previewLoading = ref(false)
const previewIssue = ref(false)
const completed = ref<number | null>()
const editing = ref(false)
const editorFocus = useEditorFocus('.v4-position-detail')
const mainRead = latestRead()
const previewRead = latestRead()
const countRead = latestRead()
function loadCompleted() {
  if (!position.value) return
  completed.value = undefined
  void countRead.execute(
    () =>
      readV3<Page<unknown>>(
        '/interviews?positionId=' + position.value!.id + '&status=completed&limit=1&offset=0'
      ),
    (page) => {
      completed.value = Number.isSafeInteger(page.total) && page.total >= 0 ? page.total : null
    },
    () => {
      completed.value = null
    }
  )
}
function loadApplications() {
  if (!position.value) return
  previewIssue.value = false
  previewLoading.value = true
  void previewRead.execute(
    () =>
      readV3<Page<Application>>(
        '/applications?positionId=' + position.value!.id + '&limit=5&offset=0'
      ),
    (page) => {
      applications.value = page.items
      previewLoading.value = false
    },
    () => {
      previewIssue.value = true
      previewLoading.value = false
    }
  )
}
function load() {
  const id = Number(route.params.id)
  if (v3Session.state.status !== 'ready') return
  if (loading.value) return
  const path = route.path
  loading.value = true
  problem.value = ''
  void mainRead.execute(
    () => readV3<Position>('/positions/' + id),
    (data) => {
      if (route.path !== path || data.id !== id) return
      position.value = data
      loading.value = false
      titleTab?.(path, data.title + ' · #' + data.id)
      loadCompleted()
      loadApplications()
    },
    (error) => {
      position.value = null
      loading.value = false
      problem.value =
        error instanceof V3Error && error.status === 404
          ? '职位不存在'
          : error instanceof V3Error && error.status === 403
            ? '没有权限查看该职位'
            : '暂时无法读取职位'
    }
  )
}
function clear() {
  mainRead.invalidate()
  previewRead.invalidate()
  countRead.invalidate()
  position.value = null
  loading.value = false
  applications.value = []
  editing.value = false
}
watch(
  [() => route.params.id, () => v3Session.state.status, () => v3Session.state.user?.id],
  () => {
    if (v3Session.state.status === 'ready' && position.value?.id === Number(route.params.id)) {
      if (!editing.value) load()
      return
    }
    if (
      v3Session.state.status === 'unavailable' &&
      position.value?.id === Number(route.params.id)
    ) {
      mainRead.invalidate()
      previewRead.invalidate()
      countRead.invalidate()
      loading.value = false
      return
    }
    clear()
    if (route.name === 'position-detail') load()
  },
  { immediate: true }
)
onUnmounted(clear)
function openEditor(event: MouseEvent) {
  if (!position.value || position.value.deletedAt !== null) return
  editorFocus.remember(event)
  editing.value = true
}
function closeEditor() {
  editing.value = false
  void editorFocus.restore()
}
function saved() {
  closeEditor()
  load()
}
</script>
