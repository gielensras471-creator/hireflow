<template>
  <section class="v3-feedback-history" aria-label="面评真实历史">
    <h3>面评真实历史</h3>
    <p v-if="!items.length">尚无面评事件。</p>
    <details v-for="event in items" :key="event.eventId" :data-feedback-event="event.eventId" open>
      <summary>
        {{ eventNames[event.eventType] ?? '面评记录' }} · 事件 #{{ event.eventId }} ·
        {{ feedbackTime(event.occurredAt) }}
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
import { feedbackTime, type FeedbackEvent } from '../api/feedback-v3'
import V3FeedbackSnapshot from './V3FeedbackSnapshot.vue'
defineProps<{ items: FeedbackEvent[]; decisions: Record<number, number> }>()
const eventNames: Record<string, string> = {
  feedback_submitted: '首次提交',
  feedback_supplemented: '晋级后补录',
  feedback_corrected: '有痕更正'
}
</script>
