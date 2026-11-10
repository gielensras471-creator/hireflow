<template>
  <section class="v3-card v3-advance-editor">
    <h3>确认 HR 晋级决定</h3>
    <p>
      原意图：{{ label(original.fromStage) }} →
      {{ label(original.toStage) }}。确认只执行一次顺序晋级。
    </p>
    <V3AdvancementFacts v-if="latest" :facts="latest.preflight" :feedback="latest.feedback" />
    <form @submit.prevent="submit">
      <label
        >晋级理由{{ latest?.preflight.reasonRequired ? '（必填）' : '（可选）'
        }}<textarea
          v-model="reason"
          aria-label="晋级理由"
          :disabled="busy || uncertain || conflict || v3Session.state.status !== 'ready'"
        />
      </label>
      <p v-if="error" class="v3-error" role="alert">{{ error }}</p>
      <p v-if="uncertain" role="status">
        晋级结果尚未确定，请重试原请求确认结果；不会发起下一阶段晋级。
      </p>
      <div v-if="conflict" class="v3-advance-conflict">
        <h3>这条申请已有新进展，晋级理由草稿已保留</h3>
        <p v-if="latest && !sameTransition(original, latest.preflight)">
          原阶段已变化，不能把旧决定变成下一次晋级。请返回查看。
        </p>
        <el-button :disabled="busy || v3Session.state.status !== 'ready'" @click="refresh"
          >刷新最新资格</el-button
        >
        <el-button
          :disabled="!retryAllowed || busy || v3Session.state.status !== 'ready'"
          @click="confirmRetry"
          >确认保留理由并重新核验</el-button
        >
      </div>
      <div class="v3-advance-actions">
        <el-button :disabled="busy" @click="cancel">返回</el-button>
        <el-button
          v-if="!conflict"
          type="primary"
          native-type="submit"
          :loading="busy"
          :disabled="
            v3Session.state.status !== 'ready' ||
            (!uncertain && (!latest || !canAdvance(latest.preflight)))
          "
          >{{ uncertain ? '重试原晋级请求' : '确认晋级' }}</el-button
        >
      </div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { readV3, writeV3, v3Session } from '../api/request-v3'
import { createWriteIntent } from '../api/v3-operation'
import { V3Error } from '../utils/auth-v3'
import { label } from '../api/recruiting-v3'
import {
  canAdvance,
  sameTransition,
  preflightSignature,
  type Preflight
} from '../api/advancement-v3'
import type { FeedbackRecord } from '../api/feedback-v3'
import { confirmV3Leave, v3DraftDirty, v3UncertainWrite } from '../router/v3-drafts'
import V3AdvancementFacts from './V3AdvancementFacts.vue'
const props = defineProps<{ original: Preflight; feedback: FeedbackRecord[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const latest = ref<{ preflight: Preflight; feedback: FeedbackRecord[] } | null>({
  preflight: props.original,
  feedback: props.feedback
})
const reason = ref(''),
  busy = ref(false),
  uncertain = ref(false),
  conflict = ref(false),
  error = ref('')
const owner = v3Session.version()
let alive = true
const current = () => alive && owner === v3Session.version()
const intent = createWriteIntent<unknown>(() => crypto.randomUUID())
let frozen: { body: { targetStage: string; reason?: string }; version: number } | null = null
const retryAllowed = computed(
  () =>
    latest.value &&
    sameTransition(props.original, latest.value.preflight) &&
    canAdvance(latest.value.preflight)
)
watch([reason, uncertain], () => {
  v3DraftDirty.value = !!reason.value || uncertain.value
  v3UncertainWrite.value = uncertain.value
})
function clear() {
  v3DraftDirty.value = false
  v3UncertainWrite.value = false
}
function cancel() {
  if (confirmV3Leave()) {
    clear()
    emit('close')
  }
}
async function readFacts() {
  const id = props.original.applicationId
  const [preflight, feedback] = await Promise.all([
    readV3<Preflight>('/applications/' + id + '/advance/preflight'),
    readV3<FeedbackRecord[]>('/applications/' + id + '/feedback')
  ])
  return { preflight, feedback }
}
async function refresh() {
  busy.value = true
  latest.value = null
  error.value = ''
  try {
    const facts = await readFacts()
    if (current()) latest.value = facts
  } catch (e) {
    if (current()) error.value = e instanceof Error ? e.message : '资格读取失败'
  } finally {
    if (current()) busy.value = false
  }
}
function confirmRetry() {
  if (
    !current() ||
    busy.value ||
    v3Session.state.status !== 'ready' ||
    !retryAllowed.value ||
    !window.confirm('确认保留原晋级目标与理由，并重新核验服务器资格？')
  )
    return
  conflict.value = false
  void submit()
}
async function submit() {
  if (!current() || busy.value || conflict.value || v3Session.state.status !== 'ready') return
  busy.value = true
  error.value = ''
  try {
    if (!frozen) {
      const known = latest.value
      const fresh = await readFacts()
      if (!current()) return
      latest.value = fresh
      if (
        !known ||
        preflightSignature(known.preflight) !== preflightSignature(fresh.preflight) ||
        !sameTransition(props.original, fresh.preflight)
      ) {
        conflict.value = true
        error.value = '服务器资格已变化，请核对最新事实后重新确认。'
        return
      }
      if (!canAdvance(fresh.preflight)) {
        error.value = '当前资格不允许晋级。'
        return
      }
      if (fresh.preflight.reasonRequired && !reason.value.trim()) {
        error.value = '请填写非空晋级业务理由。'
        return
      }
      if (
        !window.confirm(
          '确认从' +
            label(fresh.preflight.fromStage) +
            '进入' +
            label(fresh.preflight.toStage) +
            '？该操作不会自动连续晋级。'
        )
      )
        return
      frozen = {
        body: {
          targetStage: fresh.preflight.toStage!,
          ...(reason.value.trim() ? { reason: reason.value.trim() } : {})
        },
        version: fresh.preflight.version
      }
    }
    const request = frozen
    await intent.execute(
      request,
      (key) =>
        writeV3(
          'POST',
          '/applications/' + props.original.applicationId + '/advance',
          request.body,
          { operation: 'update', expectedVersion: request.version, idempotencyKey: key }
        ),
      (e) => (e instanceof V3Error ? e.status : 0)
    )
    if (current()) {
      clear()
      emit('saved')
    }
  } catch (e) {
    if (!current()) return
    error.value = e instanceof Error ? e.message : '晋级失败'
    if (e instanceof V3Error && e.status === 409) {
      conflict.value = true
      await refresh()
    }
    if (!intent.uncertain) frozen = null
  } finally {
    if (current()) {
      busy.value = false
      uncertain.value = intent.uncertain
    }
  }
}
onUnmounted(() => {
  alive = false
  clear()
})
</script>
