<template>
  <section class="v3-card v3-offer-editor">
    <h3>{{ offerActions[action] }} · 确认实际业务事实</h3>
    <p>
      {{ original.profile.name }} · {{ original.profile.positionTitle }} · 申请 #{{
        original.state.applicationId
      }}
    </p>
    <V3OfferState v-if="latest" :state="latest.state" />
    <p v-if="action === 'send'">仅登记线下已发送事实，不发送邮件或短信。</p>
    <p v-if="action === 'accept'">登记接受后仍为进行中，不等于正式录用。</p>
    <p v-if="['decline', 'confirmHire', 'close'].includes(action)" class="v3-offer-warning">
      此操作将结束招聘申请。{{
        action === 'confirmHire'
          ? '结果为已录用，并保留 Offer 已接受事实。'
          : '请确认真实结果与结束原因。'
      }}
    </p>
    <form @submit.prevent="submit">
      <fieldset :disabled="busy || uncertain || conflict || v3Session.state.status !== 'ready'">
        <label v-if="action === 'close'"
          >结束类型（必须明确选择）<select v-model="outcome" aria-label="结束类型">
            <option value="">请选择结束类型</option>
            <option
              v-for="value in original.closure.allowedOutcomes.filter((v) =>
                ['company_rejected', 'candidate_withdrew'].includes(v)
              )"
              :key="value"
              :value="value"
            >
              {{ outcomes[value] }}
            </option>
          </select></label
        >
        <label v-if="['close', 'decline', 'confirmHire'].includes(action)"
          >结束原因{{ action === 'confirmHire' ? '（可选，留空由服务器默认）' : '（必填）'
          }}<textarea v-model="reason" aria-label="结束原因" />
        </label>
      </fieldset>
      <p v-if="writing" role="status">请求正在执行，服务器可能已接收。离开页面不会撤销操作。</p>
      <p v-if="uncertain" role="status">
        本次操作结果尚未确认，服务器可能已经保存。请先核实结果；如需重试，请使用原请求，不要另建操作。
      </p>
      <p v-if="error" role="alert" class="v3-error">{{ error }}</p>
      <section v-if="conflict">
        <p class="v3-conflict-summary" role="status">
          这条记录已有新的业务进展。草稿已保留，请先查看最新状态，再决定是否继续操作。
        </p>
        <h3>记录已有新进展，原操作与理由已保留</h3>
        <p v-if="latest && !sameOfferIntent(original, latest)">
          原操作前提已变化，不能自动改为下一动作或再次结束。请返回查看。
        </p>
        <el-button
          type="primary"
          :disabled="busy || v3Session.state.status !== 'ready'"
          @click="refresh"
          >重新读取当前资格</el-button
        ><el-button
          :disabled="!retryAllowed || busy || v3Session.state.status !== 'ready'"
          @click="confirmRetry"
          >确认原意图并重新核验</el-button
        >
      </section>
      <div class="v3-offer-actions">
        <el-button :disabled="busy" @click="cancel">返回</el-button
        ><el-button
          v-if="!conflict"
          type="primary"
          native-type="submit"
          :loading="busy"
          :disabled="v3Session.state.status !== 'ready'"
          >{{ uncertain ? '重试原操作' : '确认执行' }}</el-button
        >
      </div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { readOfferContext } from '../api/offer-read'
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  offerAllowed,
  sameOfferIntent,
  offerActions,
  outcomes,
  actionPath,
  type OfferContext,
  type OfferAction
} from '../api/offer-v3'
import { writeV3, v3Session } from '../api/request-v3'
import { createWriteIntent } from '../api/v3-operation'
import { V3Error } from '../utils/auth-v3'
import { confirmV3Leave, v3DraftDirty, v3UncertainWrite } from '../router/v3-drafts'
import V3OfferState from './V3OfferState.vue'
const props = defineProps<{ original: OfferContext; action: OfferAction }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const latest = ref<OfferContext | null>(props.original),
  reason = ref(''),
  outcome = ref(''),
  busy = ref(false),
  writing = ref(false),
  uncertain = ref(false),
  conflict = ref(false),
  error = ref('')
const owner = v3Session.version()
let alive = true
const current = () => alive && owner === v3Session.version()
const intent = createWriteIntent<unknown>(() => crypto.randomUUID())
let frozen: { path: string; body: Record<string, string>; version: number } | null = null
const retryAllowed = computed(
  () =>
    latest.value &&
    sameOfferIntent(props.original, latest.value) &&
    offerAllowed(latest.value, props.action)
)
watch(
  [reason, outcome, writing, uncertain],
  () => {
    v3DraftDirty.value = !!reason.value || !!outcome.value || writing.value || uncertain.value
    v3UncertainWrite.value = writing.value || uncertain.value
  },
  { flush: 'sync' }
)
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
async function refresh() {
  busy.value = true
  latest.value = null
  try {
    const c = await readOfferContext(props.original.state.applicationId)
    if (current()) latest.value = c
  } catch (e) {
    if (current()) error.value = e instanceof Error ? e.message : '读取失败'
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
    !window.confirm('确认保留原动作和理由，并重新核验资格？')
  )
    return
  conflict.value = false
  void submit()
}
function confirmationMessage() {
  const subject =
    '申请 #' +
    props.original.state.applicationId +
    ' · ' +
    props.original.profile.name +
    ' · ' +
    props.original.profile.positionTitle
  switch (props.action) {
    case 'send':
      return '登记 Offer 已发送。确认该实际发送事实？' + subject
    case 'accept':
      return '登记候选人接受 Offer。接受后申请仍为进行中，需要 HR 后续独立确认录用。' + subject
    case 'decline':
      return (
        '登记候选人拒绝 Offer，并结束本次招聘申请。' +
        subject +
        '；结束原因：' +
        reason.value.trim()
      )
    case 'confirmHire':
      return 'HR 正式确认录用，完成后招聘申请将结束，结果为已录用。' + subject
    case 'close':
      return (
        '确认以“' +
        outcomes[outcome.value] +
        '”结束当前申请。' +
        subject +
        '；结束原因：' +
        reason.value.trim()
      )
  }
}
async function submit() {
  if (!current() || busy.value || conflict.value || v3Session.state.status !== 'ready') return
  busy.value = true
  error.value = ''
  try {
    if (!frozen) {
      const known = latest.value,
        c = await readOfferContext(props.original.state.applicationId)
      if (!current()) return
      latest.value = c
      if (
        !known ||
        JSON.stringify(known) !== JSON.stringify(c) ||
        !sameOfferIntent(props.original, c)
      ) {
        conflict.value = true
        error.value = '服务器状态或资格已变化，请重新确认。'
        return
      }
      if (!offerAllowed(c, props.action)) {
        error.value = '当前资格不允许原操作。'
        return
      }
      if (['close', 'decline'].includes(props.action) && !reason.value.trim()) {
        error.value = '请填写非空结束原因。'
        return
      }
      if (
        props.action === 'close' &&
        (!['company_rejected', 'candidate_withdrew'].includes(outcome.value) ||
          !c.closure.allowedOutcomes.includes(outcome.value))
      ) {
        error.value = '请明确选择合法结束类型。'
        return
      }
      if (!window.confirm(confirmationMessage())) return
      const body: Record<string, string> = {}
      if (['close', 'decline', 'confirmHire'].includes(props.action) && reason.value.trim())
        body.reason = reason.value.trim()
      if (props.action === 'close') body.outcome = outcome.value
      frozen = {
        path: actionPath(c.state.applicationId, props.action),
        body,
        version: c.state.version
      }
    }
    const request = frozen
    writing.value = true
    await intent.execute(
      request,
      (key) =>
        writeV3('POST', request.path, request.body, {
          operation: 'update',
          expectedVersion: request.version,
          idempotencyKey: key
        }),
      (e) => (e instanceof V3Error ? e.status : 0)
    )
    if (current()) {
      writing.value = false
      clear()
      emit('saved')
    }
  } catch (e) {
    if (!current()) return
    error.value = e instanceof Error ? e.message : '操作失败'
    if (e instanceof V3Error && e.status === 409) {
      conflict.value = true
      await refresh()
    }
    if (!intent.uncertain) frozen = null
  } finally {
    if (current()) {
      busy.value = false
      uncertain.value = intent.uncertain
      writing.value = false
    }
  }
}
onUnmounted(() => {
  alive = false
  clear()
})
</script>
