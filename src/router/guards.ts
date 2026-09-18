import type { Router } from 'vue-router'
import { APP_HOME, APP_NAME, LOGIN_PATH } from '@/config'
import { getSession } from '@/utils/auth'

export const installRouterGuards = (router: Router) => {
  router.beforeEach((to) => {
    const session = getSession()
    const isPublic = Boolean(to.meta.public)

    if (to.path === LOGIN_PATH && session) {
      return APP_HOME
    }

    if (!isPublic && !session) {
      return {
        path: LOGIN_PATH,
        query: to.fullPath !== APP_HOME ? { redirect: to.fullPath } : undefined
      }
    }

    return true
  })

  router.afterEach((to) => {
    const pageTitle = typeof to.meta.title === 'string' ? to.meta.title : ''
    document.title = pageTitle ? `${pageTitle} · ${APP_NAME}` : APP_NAME
  })
}
