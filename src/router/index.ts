import { HOME_URL, LOGIN_URL } from '@/config'
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import NProgress from '@/utils/nprogress'

const TOKEN_KEY = 'hireflow_token'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: HOME_URL
  },

  // 登录页
  {
    path: LOGIN_URL,
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: {
      title: '登录'
    }
  },

  // HireFlow 主体页面
  {
    path: '/',
    name: 'layout',
    component: () => import('@/layout/index.vue'),
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: {
          title: '工作台'
        }
      },
      {
        path: 'positions',
        name: 'positions',
        component: () => import('@/views/positions/index.vue'),
        meta: {
          title: '职位管理'
        }
      },
      {
        path: 'candidates',
        name: 'candidates',
        component: () => import('@/views/candidates/index.vue'),
        meta: {
          title: '候选人管理'
        }
      },
      {
        path: 'candidates/:id',
        name: 'candidate-detail',
        component: () => import('@/views/candidates/detail.vue'),
        meta: {
          title: '候选人详情',
          activeMenu: '/candidates'
        }
      },
      {
        path: 'interviews',
        name: 'interviews',
        component: () => import('@/views/interviews/index.vue'),
        meta: {
          title: '面试管理'
        }
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/profile/index.vue'),
        meta: {
          title: '个人中心'
        }
      }
    ]
  },

  // 500
  {
    path: '/500',
    name: '500',
    component: () => import('@/components/ErrorMessage/500.vue'),
    meta: {
      title: '500'
    }
  },

  // 所有不存在的地址进入 404
  {
    path: '/:pathMatch(.*)*',
    redirect: '/404'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

/**
 * 简化后的 HireFlow 登录守卫
 */
router.beforeEach((to) => {
  NProgress.start()

  const token = localStorage.getItem(TOKEN_KEY)

  // 已登录时再次访问登录页，回到工作台
  if (to.path === LOGIN_URL && token) {
    return HOME_URL
  }

  // 未登录访问业务页面，跳转登录页
  if (to.path !== LOGIN_URL && !token) {
    return LOGIN_URL
  }

  return true
})

router.onError((error) => {
  NProgress.done()
  console.warn('路由错误：', error.message)
})

router.afterEach(() => {
  NProgress.done()
})

export default router
