<template>
  <section class="v3-feedback-history" aria-label="面评真实历史">
    <h3>面评真实历史</h3>
    <p>{{ historyCaption(items) }} 旧版历史未核实；本来源记录不代表旧版历史完整。</p>
    <button
      v-if="items.length > 3"
      type="button"
      class="v3-history-toggle"
      :aria-expanded="historyExpanded"
      @click="toggleHistory"
    >
      {{ historyExpanded ? '收起本组全部' : '查看本组全部' }}（{{ items.length }} 条）
    </button>
    <p v-if="!items.length">当前已读取的该来源未记录可核实的业务事件。</p>
    <details
      v-for="(event, index) in orderHistory(items)"
      v-show="historyExpanded || index < 3"
      :key="event.eventId"
      :data-feedback-event="event.eventId"
    >
      <summary>
        {{
          event.eventType
            ? Object.hasOwn(eventNames, event.eventType)
              ? eventNames[event.eventType]
              : '未知，待核实'
            : '未记录事件类型'
        }}
        · 事件 #{{ event.eventId }} · {{ safeHistoryTime(event.occurredAt, feedbackTime) }} · 实际
        HR：{{ event.actorName || '未记录操作者' }} · 账号 #{{ event.actorUserId }} · 面评 #{{
          event.after?.id ?? event.before?.id ?? '未记录'
        }}
        · 面试 #{{ event.after?.interviewId ?? event.before?.interviewId ?? '未记录' }} ·
        {{ event.reason || '未记录附加原因' }}
      </summary>
      <p>实际操作 HR：{{ event.actorName }} · 账号 #{{ event.actorUserId }}</p>
      <p v-if="event.reason">更正原因：{{ event.reason }}</p>
      <p v-if="event.waiverEventId">关联原晋级豁免事件 #{{ event.waiverEventId }}</p>
      <p
        v-if="
          event.eventType === 'feedback_corrected' &&
          (event.priorAdvancementEventId || decisions[event.eventId])
        "
        class="v3-feedback-notice"
      >
        该更正发生在原招聘决策之后 · 决策事件 #{{
          event.priorAdvancementEventId ?? decisions[event.eventId]
        }}
      </p>
      <div class="v3-feedback-compare">
        <section v-if="event.before">
          <h4>更正前完整内容</h4>
          <V3FeedbackSnapshot :value="event.before" />
        </section>
        <section v-if="event.after">
          <h4>{{ event.before ? '更正后完整内容' : '实际提交内容' }}</h4>
          <V3FeedbackSnapshot :value="event.after" />
        </section>
      </div>
    </details>
  </section>
</template>
<script setup lang="ts">
import { orderHistory, historyCaption, safeHistoryTime } from '../api/history-display'
import { feedbackTime, type FeedbackEvent } from '../api/feedback-v3'
import V3FeedbackSnapshot from './V3FeedbackSnapshot.vue'
const props = defineProps<{ items: FeedbackEvent[]; decisions: Record<number, number> }>()
import { ref, nextTick, watch } from 'vue'
const eventNames: Record<string, string> = {
  feedback_submitted: '首次提交',
  feedback_supplemented: '晋级后补录',
  feedback_corrected: '有痕更正'
}

const historyExpanded = ref(false)
async function toggleHistory(event: Event) {
  const control = event.currentTarget as HTMLButtonElement
  historyExpanded.value = !historyExpanded.value
  if (!historyExpanded.value) {
    await nextTick()
    control.focus({ preventScroll: true })
  }
}
watch(
  () => props.items,
  () => {
    historyExpanded.value = false
  }
)
</script>
