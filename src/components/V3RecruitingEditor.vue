<template>
  <section class="v3-card v3-editor" aria-labelledby="editor-title">
    <h2 id="editor-title">{{ title }}</h2>
    <p v-if="action === 'status'">
      该职位有 {{ position?.activeApplications }} 条活跃申请。关闭职位不会结束已有申请。
    </p>
    <p v-if="action === 'archive'">归档后不能接收新申请。现有申请和历史关联会保留。</p>
    <form @submit.prevent="submit">
      <fieldset :disabled="busy || uncertain || conflict || v3Session.state.status !== 'ready'">
        <label v-if="!positions && !row"
          >应聘职位
          <select v-model="positionId" required aria-label="应聘职位">
            <option value="">请选择开放职位</option>
            <option v-for="option in options" :key="option.id" :value="option.id">
              {{ option.title }} · #{{ option.id }}
            </option>
          </select>
        </label>
        <p v-else-if="!positions">
          应聘职位 #{{ (row as Application)?.positionId }} · 创建后不可改岗
        </p>
        <template v-if="action === 'edit'">
          <label v-for="[key, text] in fields" :key="key"
            >{{ text }}
            <textarea
              v-if="['description', 'note', 'experience', 'skills'].includes(key)"
              v-model="draft[key]"
              :aria-label="text"
            />
            <input
              v-else
              v-model="draft[key]"
              :aria-label="text"
              :type="key.endsWith('Date') ? 'date' : key === 'email' ? 'email' : 'text'"
              :required="['title', 'name', 'owner', 'publishDate', 'appliedDate'].includes(key)"
            />
          </label>
        </template>
      </fieldset>
      <p v-if="error" role="alert" class="v3-error">{{ error }}</p>
      <p v-if="uncertain" role="status">
        提交结果尚未确定。请使用原请求重试确认，期间不能修改内容。
      </p>
      <div v-if="conflict" class="v3-conflict">
        <p>
          草稿已保留。{{
            latest ? '已读取服务器最新版本 ' + latest.version : '需重新读取服务器状态后再确认'
          }}。
        </p>
        <dl v-if="latest" class="v3-profile">
          <template v-for="[key, text] in fields" :key="key">
            <dt>{{ text }} · 服务器当前值</dt>
            <dd>{{ serverValue(key) }}</dd>
          </template>
        </dl>
        <el-button :disabled="busy" @click="refreshConflict">重新读取</el-button>
        <el-button :disabled="!latest || busy" @click="confirmConflict"
          >确认按新版本提交草稿</el-button
        >
      </div>
      <div class="v3-editor-actions">
        <el-button :disabled="busy || uncertain" @click="cancel">取消</el-button>
        <el-button
          v-if="!conflict"
          type="primary"
          native-type="submit"
          :loading="busy"
          :disabled="v3Session.state.status !== 'ready'"
        >
          {{ uncertain ? '重试原请求' : '确认提交' }}
        </el-button>
      </div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { v3Session, writeV3 } from '../api/request-v3'
import { V3Error } from '../utils/auth-v3'
import { createWriteIntent } from '../api/v3-operation'
import {
  applicationFields,
  positionFields,
  detail,
  type Application,
  type Position,
  type RecruitingRow
} from '../api/recruiting-v3'
import { v3DraftDirty, v3UncertainWrite, confirmV3Leave } from '../router/v3-drafts'
const props = defineProps<{
  positions: boolean
  row: RecruitingRow | null
  action: 'edit' | 'status' | 'archive'
  options: Position[]
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const position = computed(() => (props.positions ? (props.row as Position | null) : null))
const fields = computed(() => (props.positions ? positionFields : applicationFields))
const title = computed(() =>
  props.action === 'status'
    ? '确认职位状态变更'
    : props.action === 'archive'
      ? '确认归档职位'
      : (props.row ? '编辑' : '新建') + (props.positions ? '职位' : '申请')
)
const draft = reactive<Record<string, string>>(
  Object.fromEntries(
    fields.value.map(([key]) => [
      key,
      String((props.row as unknown as Record<string, unknown>)?.[key] ?? '')
    ])
  )
)
const initial = JSON.stringify(draft)
const positionId = ref<number | ''>('')
const busy = ref(false),
  uncertain = ref(false),
  conflict = ref(false),
  error = ref('')
const latest = ref<RecruitingRow | null>(null)
const expected = ref(props.row?.version)
const owner = v3Session.version()
const operation = createWriteIntent<unknown>(() => crypto.randomUUID())
let frozen: { path: string; body: Record<string, unknown>; version?: number } | null = null
watch(
  [draft, positionId, uncertain],
  () => {
    v3UncertainWrite.value = uncertain.value
    v3DraftDirty.value =
      JSON.stringify(draft) !== initial || positionId.value !== '' || uncertain.value
  },
  { deep: true }
)
function serverValue(key: string) {
  return (latest.value as unknown as Record<string, unknown>)?.[key] ?? '—'
}
function cancel() {
  if (confirmV3Leave()) {
    v3UncertainWrite.value = false
    v3DraftDirty.value = false
    emit('close')
  }
}
async function refreshConflict() {
  if (!props.row) return
  busy.value = true
  latest.value = null
  try {
    latest.value = await detail(props.positions ? 'positions' : 'applications', props.row.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '无法读取最新状态'
  } finally {
    busy.value = false
  }
}
function confirmConflict() {
  if (!latest.value || !window.confirm('确认保留当前草稿，并基于刚读取的服务器版本发起新操作？'))
    return
  expected.value = latest.value.version
  conflict.value = false
  frozen = null
  void submit()
}
async function submit() {
  if (busy.value || conflict.value) return
  if (v3Session.version() !== owner) {
    error.value = '账号已变更，请重新打开表单。'
    return
  }
  if (!frozen) {
    const resource = props.positions ? 'positions' : 'applications'
    let body: Record<string, unknown> = { ...draft }
    if (!props.positions && !props.row) body.positionId = Number(positionId.value)
    let suffix = ''
    if (props.action === 'status') {
      suffix = '/status'
      body = { status: position.value?.status === 'open' ? 'closed' : 'open' }
    }
    if (props.action === 'archive') {
      suffix = '/archive'
      body = {}
    }
    frozen = {
      path: '/' + resource + (props.row ? '/' + props.row.id : '') + suffix,
      body,
      version: expected.value
    }
  }
  busy.value = true
  error.value = ''
  const request = frozen
  try {
    await operation.execute(
      request,
      (key) =>
        writeV3(
          props.row && props.action === 'edit' ? 'PATCH' : 'POST',
          request.path,
          request.body,
          props.row
            ? { operation: 'update', expectedVersion: request.version!, idempotencyKey: key }
            : { operation: 'create', idempotencyKey: key }
        ),
      (e) => (e instanceof V3Error ? e.status : 0)
    )
    if (v3Session.version() !== owner) return
    v3UncertainWrite.value = false
    v3DraftDirty.value = false
    emit('saved')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败'
    if (e instanceof V3Error && e.code === 'VERSION_CONFLICT') {
      conflict.value = true
      await refreshConflict()
    }
    if (!operation.uncertain) frozen = null
  } finally {
    uncertain.value = operation.uncertain
    busy.value = false
  }
}
onUnmounted(() => {
  v3UncertainWrite.value = false
  v3DraftDirty.value = false
})
</script>
