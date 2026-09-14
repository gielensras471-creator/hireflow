<template>
  <div class="login-page">
    <!-- 左侧品牌展示区 -->
    <section class="brand-panel">
      <div class="brand-top">
        <div class="brand-logo">HF</div>

        <div>
          <strong>HireFlow</strong>
          <span>招聘流程协作平台</span>
        </div>
      </div>

      <div class="brand-content">
        <span class="brand-badge"> Recruitment Workspace </span>

        <h1>
          让招聘流程<br />
          更清晰、更高效
        </h1>

        <p>从职位发布、候选人管理到面试安排， 在一个工作区完成招聘流程协作。</p>

        <div class="feature-list">
          <div class="feature-item">
            <span class="feature-icon">01</span>
            <div>
              <strong>职位统一管理</strong>
              <p>跟踪开放职位与招聘状态</p>
            </div>
          </div>

          <div class="feature-item">
            <span class="feature-icon">02</span>
            <div>
              <strong>候选人流程跟进</strong>
              <p>清晰管理筛选、初面、复面与 Offer</p>
            </div>
          </div>

          <div class="feature-item">
            <span class="feature-icon">03</span>
            <div>
              <strong>面试协作安排</strong>
              <p>统一管理面试时间、状态与负责人</p>
            </div>
          </div>
        </div>
      </div>

      <div class="brand-decoration brand-decoration--one"></div>
      <div class="brand-decoration brand-decoration--two"></div>
    </section>

    <!-- 右侧登录区 -->
    <section class="login-panel">
      <div class="login-card">
        <div class="mobile-brand">
          <div class="mobile-brand__logo">HF</div>

          <strong>HireFlow</strong>
        </div>

        <div class="login-heading">
          <span>WELCOME BACK</span>

          <h2>欢迎登录</h2>

          <p>登录 HireFlow 招聘流程协作平台</p>
        </div>

        <LoginForm ref="loginRef" />

        <div class="login-btns">
          <el-button class="login-btn" size="large" @click="handleResetClick"> 重置 </el-button>

          <el-button
            type="primary"
            size="large"
            class="login-btn login-btn--primary"
            @click="handleSubmitClick"
          >
            立即登录
          </el-button>
        </div>

        <div class="demo-tip">
          演示账号：admin
          <span>·</span>
          密码：123456
        </div>
      </div>

      <p class="login-footer">HireFlow · Recruitment Workflow Platform</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import LoginForm from './components/LoginForm.vue'

const loginRef = ref<InstanceType<typeof LoginForm>>()

const handleSubmitClick = () => {
  loginRef.value?.loginAction()
}

const handleResetClick = () => {
  loginRef.value?.resetAction()
}
</script>

<style scoped lang="scss">
.login-page {
  display: grid;
  grid-template-columns:
    minmax(420px, 46%)
    minmax(520px, 54%);
  width: 100%;
  min-height: 100vh;
  background: #f5f7fb;
}

/* =====================
   左侧品牌区域
===================== */

.brand-panel {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 42px 56px;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(145deg, #153db7 0%, #2254f4 52%, #4d78ff 100%);
}

.brand-top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 13px;

  strong {
    display: block;
    font-size: 20px;
    font-weight: 700;
  }

  span {
    display: block;
    margin-top: 3px;
    color: rgb(255 255 255 / 68%);
    font-size: 11px;
  }
}

.brand-logo,
.mobile-brand__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  color: #2254f4;
  font-size: 14px;
  font-weight: 700;
  background: #fff;
  border-radius: 12px;
}

.brand-content {
  position: relative;
  z-index: 2;
  width: min(500px, 100%);
  margin: auto 0;
}

.brand-badge {
  display: inline-flex;
  padding: 7px 12px;
  color: rgb(255 255 255 / 88%);
  font-size: 11px;
  letter-spacing: 0.6px;
  background: rgb(255 255 255 / 12%);
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 999px;
}

.brand-content h1 {
  margin: 24px 0 18px;
  font-size: clamp(38px, 4vw, 58px);
  font-weight: 700;
  line-height: 1.16;
  letter-spacing: -1.5px;
}

.brand-content > p {
  max-width: 440px;
  margin: 0;
  color: rgb(255 255 255 / 72%);
  font-size: 14px;
  line-height: 1.9;
}

.feature-list {
  display: grid;
  gap: 14px;
  margin-top: 38px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 13px;

  strong {
    display: block;
    font-size: 13px;
    font-weight: 600;
  }

  p {
    margin: 4px 0 0;
    color: rgb(255 255 255 / 58%);
    font-size: 11px;
  }
}

.feature-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  background: rgb(255 255 255 / 13%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 10px;
}

.brand-decoration {
  position: absolute;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 50%;
}

.brand-decoration--one {
  right: -150px;
  bottom: -150px;
  width: 500px;
  height: 500px;
}

.brand-decoration--two {
  right: 40px;
  bottom: 80px;
  width: 250px;
  height: 250px;
}

/* =====================
   登录区域
===================== */

.login-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 40px;
}

.login-card {
  box-sizing: border-box;
  width: min(430px, 100%);
  padding: 38px 40px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 18px;
  box-shadow: 0 18px 60px rgb(31 35 48 / 8%);
}

.mobile-brand {
  display: none;
}

.login-heading {
  margin-bottom: 28px;

  > span {
    color: var(--el-color-primary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.3px;
  }

  h2 {
    margin: 8px 0 7px;
    color: var(--el-text-color-primary);
    font-size: 26px;
    font-weight: 700;
  }

  p {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
}

:deep(.el-form-item) {
  margin-bottom: 20px;
}

:deep(.el-input__wrapper) {
  min-height: 44px;
  padding: 0 14px;
  border-radius: 9px;
  box-shadow: 0 0 0 1px var(--el-border-color) inset;
}

:deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--el-color-primary-light-5) inset;
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}

:deep(.expires7d) {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.login-btns {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 10px;
  margin-top: 6px;
}

.login-btn {
  width: 100%;
  height: 44px;
  margin: 0 !important;
  border-radius: 9px;
}

.login-btn--primary {
  box-shadow: 0 8px 18px rgb(34 84 244 / 18%);
}

.demo-tip {
  margin-top: 18px;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  text-align: center;

  span {
    margin: 0 6px;
  }
}

.login-footer {
  margin: 20px 0 0;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}

@media (max-width: 1000px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .brand-panel {
    display: none;
  }

  .login-panel {
    padding: 24px;
  }

  .mobile-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 30px;

    strong {
      color: var(--el-text-color-primary);
      font-size: 19px;
    }
  }

  .mobile-brand__logo {
    width: 38px;
    height: 38px;
    color: #fff;
    background: var(--el-color-primary);
  }
}

@media (max-width: 520px) {
  .login-panel {
    padding: 16px;
  }

  .login-card {
    padding: 28px 22px;
    border-radius: 14px;
  }
}
</style>
