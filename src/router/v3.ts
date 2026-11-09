import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { v3Session } from '../api/request-v3'
import { v3SessionKey } from '../utils/auth-v3'
import V3Shell from '../layouts/V3Shell.vue'
import V3Login from '../views/login/V3Login.vue'
import V3Placeholder from '../layouts/V3Placeholder.vue'
import V3Recruiting from '../views/V3Recruiting.vue'
import V3Interviews from '../views/V3Interviews.vue'
import { confirmV3Leave, v3DraftDirty } from './v3-drafts'
import { safeReturn, tabInfo, v3Sections } from './v3-navigation'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'v3-login', component: V3Login },
    {
      path: '/',
      component: V3Shell,
      redirect: '/dashboard',
      children: [
        ...v3Sections.map(({ path, name }) => ({
          path,
          name,
          component: ['positions', 'candidates'].includes(name)
            ? V3Recruiting
            : name === 'interviews'
              ? V3Interviews
              : V3Placeholder
        })),
        { path: '/candidates/:id', name: 'candidate-detail', component: V3Recruiting },
        { path: '/profile', name: 'v3-profile', component: V3Placeholder }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
  ]
})

router.beforeEach(async (to, from) => {
  if (to.name !== 'v3-login' && !tabInfo(to.path)) return '/dashboard'
  if (v3Session.state.status === 'ready' && to.fullPath !== from.fullPath && !confirmV3Leave())
    return false
  if (v3Session.token()) await v3Session.refresh()
  const status = v3Session.state.status
  if (to.name === 'v3-login') return status === 'ready' ? safeReturn(to.query.redirect) : true
  if (status === 'unavailable' && v3Session.state.user) return false
  if (status === 'ready' || status === 'unavailable') return true
  return { name: 'v3-login', query: { redirect: safeReturn(to.fullPath) } }
})
router.afterEach((to, from, failure) => {
  if (!failure && to.fullPath !== from.fullPath) v3DraftDirty.value = false
})

watch(
  () => v3Session.state.status,
  (status) => {
    if (status !== 'anonymous' && status !== 'forbidden') return
    v3DraftDirty.value = false
    const current = router.currentRoute.value
    if (tabInfo(current.path)) {
      void router.replace({ name: 'v3-login' })
    }
  }
)

window.addEventListener('storage', (event) => {
  if (event.storageArea === localStorage && (event.key === v3SessionKey || event.key === null))
    v3Session.clear()
})

export default router
