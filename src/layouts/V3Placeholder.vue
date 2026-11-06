<template>
  <section v-if="route.name === 'v3-profile'" class="v3-card">
    <h1>个人中心</h1>
    <dl v-if="user" class="v3-profile">
      <dt>账号</dt>
      <dd>{{ user.username }}</dd>
      <dt>姓名</dt>
      <dd>{{ user.name }}</dd>
      <dt>角色</dt>
      <dd>{{ user.role }}</dd>
    </dl>
    <p>资料编辑与密码修改暂不可用。</p>
  </section>
  <section v-else>
    <h1>{{ title }}</h1>
    <V3Feedback
      state="empty"
      title="V3 功能接入中"
      message="当前仅开放本地会话、导航与标签页验证。招聘操作将在后续批次接入。"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { v3Session } from '../api/request-v3'
import { tabInfo } from '../router/v3-navigation'
import V3Feedback from '../components/V3Feedback.vue'

const route = useRoute()
const user = computed(() => v3Session.state.user)
const title = computed(() => tabInfo(route.path)?.title)
</script>
