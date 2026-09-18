import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'
import { installRouterGuards } from './guards'

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

installRouterGuards(router)

export default router
