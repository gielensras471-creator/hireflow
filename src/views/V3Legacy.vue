<template>
  <section class="v3-legacy">
    <h1>{{ detailMode ? '旧档详情' : '旧版档案' }}</h1>
    <p>旧版只读档案，不是可操作的新申请。未知事实保持待核实，不依据当前阶段补造历史。</p>
    <RouterLink v-if="detailMode" to="/legacy-records">返回旧版档案列表</RouterLink>
    <form v-else class="v3-card" @submit.prevent="filter">
      <label
        >实体类型<select v-model="entity" aria-label="旧档实体类型">
          <option value="">全部类型</option>
          <option v-for="(text, key) in entityLabels" :key="key" :value="key">{{ text }}</option>
        </select></label
      >
      <label
        >职位映射<select v-model="mapping" aria-label="旧档映射状态">
          <option value="">全部映射状态</option>
          <option v-for="(text, key) in mappingLabels" :key="key" :value="key">{{ text }}</option>
        </select></label
      >
      <el-button native-type="submit">筛选档案</el-button>
    </form>
    <V3Feedback v-if="loading" state="loading" title="读取旧版档案中" />
    <V3Feedback
      v-else-if="error"
      state="error"
      :title="missing ? '未找到旧档记录' : '暂时无法读取旧档'"
      :message="error"
      action="重新读取旧档"
      @action="load"
    />
    <article v-else-if="record" class="v3-card" aria-label="只读旧档详情">
      <h2>{{ entityLabels[record.entityType] }} #{{ record.legacyId }}</h2>
      <dl>
        <dt>来源指纹</dt>
        <dd>{{ record.sourceKey }}</dd>
        <dt>历史核实状态</dt>
        <dd>{{ record.hint }}</dd>
        <dt>职位映射状态</dt>
        <dd>{{ mappingLabels[record.mappingStatus] ?? '未知，待核实' }}</dd>
        <dt>映射职位 ID</dt>
        <dd>{{ record.mappedPositionId ?? '未建立关联；不是有效新申请' }}</dd>
        <dt>归档导入时间（不是历史发生时间）</dt>
        <dd>{{ feedbackTime(record.importedAt) }}</dd>
      </dl>
      <h3>旧库保留的标记</h3>
      <p>{{ legacyFact(record.raw.stage ?? record.raw.status) }}</p>
      <h3>已确认事实与未知事实</h3>
      <dl>
        <template v-for="(value, key) in record.facts" :key="key"
          ><dt>{{ factLabels[key] ?? '未核实字段' }}</dt>
          <dd>{{ legacyFact(value) }}</dd></template
        >
      </dl>
      <p>
        未提供经核实的历史业务事件。导入时间不能证明面试、淘汰或 Offer
        发生时间；本页不提供招聘写入操作。
      </p>
    </article>
    <template v-else-if="page">
      <V3Feedback v-if="!page.items.length" state="empty" title="暂无符合条件的旧版档案" />
      <div v-else class="v3-card legacy-table">
        <table aria-label="旧版档案列表">
          <thead>
            <tr>
              <th>旧记录标识</th>
              <th>来源</th>
              <th>职位映射</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in page.items"
              :key="JSON.stringify([row.sourceKey, row.entityType, row.legacyId])"
            >
              <td>{{ entityLabels[row.entityType] }} #{{ row.legacyId }}</td>
              <td>{{ row.sourceKey }}</td>
              <td>{{ mappingLabels[row.mappingStatus] }}</td>
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
      </div>
      <p>共 {{ page.total }} 条归档记录；不是活跃申请数。</p>
      <el-button :disabled="offset === 0" @click="changePage(-20)">上一页旧档</el-button
      ><el-button :disabled="offset + 20 >= page.total" @click="changePage(20)"
        >下一页旧档</el-button
      >
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { readV3, v3Session } from '../api/request-v3'
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
import V3Feedback from '../components/V3Feedback.vue'
const route = useRoute(),
  detailMode = computed(() => route.path.endsWith('/detail'))
const entity = ref(''),
  mapping = ref(''),
  offset = ref(0),
  loading = ref(false),
  error = ref(''),
  missing = ref(false),
  page = ref<LegacyPage | null>(null),
  record = ref<LegacyDetail | null>(null),
  reads = latestRead()
function load() {
  reads.invalidate()
  page.value = null
  record.value = null
  error.value = ''
  loading.value = false
  missing.value = false
  if (v3Session.state.status !== 'ready') return
  const q = new URLSearchParams()
  if (detailMode.value) {
    for (const key of ['sourceKey', 'entityType', 'legacyId']) {
      const v = route.query[key]
      if (typeof v !== 'string') {
        error.value = '旧档标识无效，请从档案列表重新选择。'
        return
      }
      q.set(key, v)
    }
  } else {
    q.set('limit', '20')
    q.set('offset', String(offset.value))
    if (entity.value) q.set('entityType', entity.value)
    if (mapping.value) q.set('mappingStatus', mapping.value)
  }
  loading.value = true
  const detail = detailMode.value
  return reads.execute(
    () =>
      readV3<LegacyDetail | LegacyPage>(
        (detail ? '/legacy-records?' : '/legacy-records/list?') + q
      ),
    (v) => {
      if (detail) record.value = v as LegacyDetail
      else page.value = v as LegacyPage
      loading.value = false
    },
    (e) => {
      missing.value = (e as { status?: number }).status === 404
      error.value = e instanceof Error ? e.message : '读取失败，请重试。'
      loading.value = false
    }
  )
}
function filter() {
  offset.value = 0
  void load()
}
function changePage(delta: number) {
  offset.value += delta
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
<style scoped>
.v3-legacy {
  min-width: 0;
}
dl {
  display: grid;
  gap: 8px;
}
dd {
  margin: 0 0 12px;
  overflow-wrap: anywhere;
}
.legacy-table {
  overflow-x: auto;
}
table {
  min-width: 640px;
  width: 100%;
  text-align: left;
}
td,
th {
  padding: 12px;
}
td {
  max-width: 240px;
  overflow-wrap: anywhere;
}
label {
  display: inline-flex;
  gap: 8px;
  padding: 8px;
}
</style>
