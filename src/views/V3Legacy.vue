<template>
  <section class="v3-legacy" aria-labelledby="legacy-title">
    <header class="legacy-heading">
      <RouterLink v-if="detailMode" to="/legacy-records">← 返回旧版档案列表</RouterLink>
      <div>
        <h1 id="legacy-title">
          {{
            record
              ? entityLabel(record.entityType) + ' · #' + record.legacyId
              : detailMode
                ? '旧档详情'
                : '旧版档案'
          }}
        </h1>
        <div v-if="detailMode" class="legacy-detail-badges">
          <span class="legacy-badge legacy-readonly">只读</span>
          <span
            v-if="record?.hint || record?.historyStatus"
            class="legacy-badge legacy-historical"
            >{{ record.hint || record.historyStatus }}</span
          >
        </div>
      </div>
      <p>{{ detailMode ? '旧版档案详情' : '查阅迁移归档的旧记录与职位映射状态。' }}</p>
    </header>

    <form
      v-if="!detailMode"
      class="v3-card v3-filter-toolbar legacy-filters"
      @submit.prevent="filter"
    >
      <V3FilterSelect
        id="legacy-entity"
        v-model="entity"
        label="实体类型"
        all-label="全部类型"
        :options="entityLabels"
      />
      <V3FilterSelect
        id="legacy-mapping"
        v-model="mapping"
        label="职位映射状态"
        all-label="全部映射状态"
        :options="mappingLabels"
      />
      <div class="v3-filter-actions">
        <el-button class="legacy-apply" native-type="submit" type="primary">筛选档案</el-button>
        <el-button class="legacy-clear" text @click="clearFilters">清除筛选</el-button>
      </div>
    </form>

    <div class="legacy-notice" :class="{ 'legacy-notice-detail': detailMode }" role="note">
      <strong>{{ detailMode ? '归档导入时间不等于历史事件发生时间。' : '归档记录只读' }}</strong>
      <p>
        {{
          detailMode
            ? '未知事实保持待核实。此档案独立于活跃申请。'
            : '旧版档案不计入活跃申请。旧版阶段不能用于推定新招聘流程。'
        }}
      </p>
    </div>

    <V3Feedback v-if="loading" state="loading" title="读取旧版档案中" />
    <V3Feedback
      v-else-if="issue"
      state="error"
      :title="issue.title"
      :message="issue.message"
      :action="issue.retry ? '重新读取旧档' : undefined"
      @action="load"
    />

    <article v-else-if="record" class="legacy-detail" aria-label="只读旧档详情">
      <section class="v3-card">
        <h2>档案来源</h2>
        <div class="legacy-columns">
          <dl>
            <div>
              <dt>实体类型</dt>
              <dd>{{ entityLabel(record.entityType) }} · {{ record.entityType }}</dd>
            </div>
            <div>
              <dt>旧记录 ID</dt>
              <dd>#{{ record.legacyId }}</dd>
            </div>
            <div>
              <dt>来源指纹（sourceKey）</dt>
              <dd class="legacy-fingerprint">{{ record.sourceKey }}</dd>
            </div>
            <div>
              <dt>归档导入时间（北京时间）</dt>
              <dd>{{ feedbackTime(record.importedAt).replace(/（北京时间）$/, '') }}</dd>
            </div>
          </dl>
          <dl>
            <div>
              <dt>历史核实状态</dt>
              <dd>{{ record.hint || record.historyStatus || '未知，待核实' }}</dd>
            </div>
            <div>
              <dt>职位映射状态</dt>
              <dd>{{ mappingLabel(record.mappingStatus) }}</dd>
            </div>
            <div>
              <dt>映射职位 ID</dt>
              <dd>{{ record.mappedPositionId ?? '未建立关联；不是有效新申请' }}</dd>
            </div>
            <div>
              <dt>旧库保留标记</dt>
              <dd>{{ legacyFact(record.raw.stage ?? record.raw.status) }}</dd>
            </div>
          </dl>
        </div>
      </section>
      <div class="legacy-columns legacy-detail-facts">
        <section class="v3-card">
          <h2>已确认事实</h2>
          <p>来自旧档读取接口公开的枚举字段。</p>
          <dl v-if="confirmedFacts.length">
            <div v-for="[label, value] in confirmedFacts" :key="label">
              <dt>{{ label }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
          <p v-else class="legacy-no-facts">暂无已核实字段。</p>
          <div class="legacy-notice legacy-note-neutral">
            按归档字段读取。未提供经核实的历史业务事件。
          </div>
        </section>
        <section class="v3-card">
          <h2>未知事实</h2>
          <p>接口返回空值时保持待核实。</p>
          <dl v-if="unknownFacts.length">
            <div v-for="[label, value] in unknownFacts" :key="label">
              <dt>{{ label }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
          <p v-else class="legacy-no-facts">未返回其他可核实字段。</p>
        </section>
      </div>
    </article>

    <section v-else-if="page" class="v3-card legacy-list">
      <header class="legacy-list-heading">
        <h2>档案记录</h2>
        <p>仅供查阅的归档资料</p>
      </header>
      <V3Feedback
        v-if="!page.items.length"
        state="empty"
        :title="filtered ? '暂无符合条件的旧版档案' : '暂无旧版档案'"
        :message="filtered ? '可调整筛选条件后再查看。' : '当前没有可供查阅的归档记录。'"
      />
      <V3TableScroll v-else name="旧版档案表格" vertical>
        <table aria-label="旧版档案列表">
          <thead>
            <tr>
              <th scope="col">旧记录标识</th>
              <th scope="col">来源指纹（sourceKey）</th>
              <th scope="col">职位映射状态</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in page.items"
              :key="JSON.stringify([row.sourceKey, row.entityType, row.legacyId])"
            >
              <td>
                {{ entityLabel(row.entityType) }} <span class="legacy-id">#{{ row.legacyId }}</span>
              </td>
              <td class="legacy-fingerprint">{{ row.sourceKey }}</td>
              <td>
                <span class="legacy-badge" :data-mapping="row.mappingStatus">{{
                  mappingLabel(row.mappingStatus)
                }}</span>
              </td>
              <td>
                <RouterLink
                  :to="{
                    path: '/legacy-records/detail',
                    query: {
                      sourceKey: row.sourceKey,
                      entityType: row.entityType,
                      legacyId: String(row.legacyId)
                    }
                  }"
                  >查看只读旧档</RouterLink
                >
              </td>
            </tr>
          </tbody>
        </table>
      </V3TableScroll>
      <footer class="legacy-footer">
        <p role="status">
          共 {{ page.total }} 条<span v-if="page.total">
            · 第 {{ Math.floor(offset / pageSize) + 1 }} /
            {{ Math.ceil(page.total / pageSize) }} 页</span
          >
          · 每页 {{ pageSize }} 条
        </p>
        <nav class="v3-filter-actions" aria-label="旧版档案分页">
          <el-button :disabled="offset === 0" @click="changePage(-pageSize)">上一页旧档</el-button>
          <el-button :disabled="offset + pageSize >= page.total" @click="changePage(pageSize)"
            >下一页旧档</el-button
          >
        </nav>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { adaptV3Error, readV3, v3Session } from '../api/request-v3'
import { latestRead } from '../api/v3-operation'
import { feedbackTime } from '../api/feedback-v3'
import {
  entityLabels,
  mappingLabels,
  factLabels,
  legacyFact,
  type LegacyDetail,
  type LegacyPage
} from '../api/legacy-v3'
import V3FilterSelect from '../components/V3FilterSelect.vue'
import V3Feedback from '../components/V3Feedback.vue'
import V3TableScroll from '../components/V3TableScroll.vue'

const route = useRoute()
const detailMode = computed(() => route.path === '/legacy-records/detail')
const pageSize = 20
const entity = ref('')
const mapping = ref('')
const applied = ref({ entity: '', mapping: '' })
const filtered = computed(() => Boolean(applied.value.entity || applied.value.mapping))
const offset = ref(0)
const loading = ref(false)
const issue = ref<{ title: string; message: string; retry?: boolean }>()
const page = ref<LegacyPage | null>(null)
const record = ref<LegacyDetail | null>(null)
const reads = latestRead()
const entityLabel = (value: string) => entityLabels[value] ?? '旧记录'
const mappingLabel = (value: string) => mappingLabels[value] ?? '未知，待核实'
const factRows = computed(() =>
  Object.entries(record.value?.facts ?? {}).flatMap(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(factLabels, key)) return []
    const text = legacyFact(value)
    return [{ label: factLabels[key], text, known: text !== '未知，待核实' }]
  })
)
const confirmedFacts = computed(() =>
  factRows.value.filter(({ known }) => known).map(({ label, text }) => [label, text])
)
const unknownFacts = computed(() =>
  factRows.value.filter(({ known }) => !known).map(({ label, text }) => [label, text])
)

function load() {
  reads.invalidate()
  page.value = null
  record.value = null
  issue.value = undefined
  loading.value = false
  if (v3Session.state.status !== 'ready') return

  const detail = detailMode.value
  const query = new URLSearchParams()
  if (detail) {
    const { sourceKey, entityType, legacyId } = route.query
    if (
      typeof sourceKey !== 'string' ||
      !sourceKey.trim() ||
      sourceKey.length > 128 ||
      typeof entityType !== 'string' ||
      !Object.prototype.hasOwnProperty.call(entityLabels, entityType) ||
      typeof legacyId !== 'string' ||
      !/^(0|-?[1-9]\d*)$/.test(legacyId) ||
      !Number.isSafeInteger(Number(legacyId))
    ) {
      issue.value = { title: '旧档标识无效', message: '请返回档案列表重新选择记录。' }
      return
    }
    query.set('sourceKey', sourceKey)
    query.set('entityType', entityType)
    query.set('legacyId', legacyId)
  } else {
    query.set('limit', String(pageSize))
    query.set('offset', String(offset.value))
    if (applied.value.entity) query.set('entityType', applied.value.entity)
    if (applied.value.mapping) query.set('mappingStatus', applied.value.mapping)
  }

  loading.value = true
  return reads.execute(
    () =>
      readV3<LegacyDetail | LegacyPage>(
        (detail ? '/legacy-records?' : '/legacy-records/list?') + query
      ),
    (value) => {
      if (detail) record.value = value as LegacyDetail
      else {
        const result = value as LegacyPage
        const lastOffset = Math.floor(Math.max(0, result.total - 1) / pageSize) * pageSize
        if (offset.value > lastOffset) {
          offset.value = lastOffset
          void load()
          return
        }
        page.value = result
      }
      loading.value = false
    },
    (error) => {
      const problem = adaptV3Error(error)
      if (problem.status === 404)
        issue.value = { title: '未找到旧档记录', message: '请返回档案列表重新选择记录。' }
      else if (problem.status === 403)
        issue.value = { title: '没有权限读取旧档', message: problem.message }
      else if (problem.status === 401)
        issue.value = { title: '会话已失效', message: '请重新登录后查阅旧版档案。' }
      else if (problem.status === 400)
        issue.value = {
          title: '旧档查询条件无效',
          message: '请确认筛选条件或返回档案列表重新选择。'
        }
      else issue.value = { title: '暂时无法读取旧档', message: problem.message, retry: true }
      loading.value = false
    }
  )
}

function filter() {
  applied.value = { entity: entity.value, mapping: mapping.value }
  offset.value = 0
  void load()
}
function clearFilters() {
  entity.value = mapping.value = ''
  filter()
}
function changePage(delta: number) {
  const target = offset.value + delta
  if (!page.value || target < 0 || target >= page.value.total) return
  offset.value = target
  void load()
}
watch(
  [() => route.fullPath, () => v3Session.state.status, () => v3Session.state.user?.id],
  () => {
    void load()
  },
  { immediate: true }
)
onUnmounted(() => reads.invalidate())
</script>

<style scoped lang="scss" src="./v4-legacy.scss"></style>
