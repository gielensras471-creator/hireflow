import type { RouteRecordRaw } from 'vue-router'
import { APP_HOME, LOGIN_PATH } from '@/config'

export const routes: RouteRecordRaw[] = [
  {
    path: LOGIN_PATH,
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: {
      title: '登录',
      public: true
    }
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    redirect: APP_HOME,
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '工作台' }
      },
      {
        path: 'positions',
        name: 'positions',
        component: () => import('@/views/positions/index.vue'),
        meta: { title: '职位管理' }
      },
      {
        path: 'candidates',
        name: 'candidates',
        component: () => import('@/views/candidates/index.vue'),
        meta: { title: '候选人管理' }
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
        meta: { title: '面试管理' }
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/profile/index.vue'),
        meta: { title: '个人中心' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/system/NotFoundView.vue'),
    meta: {
      title: '页面不存在',
      public: true
    }
  }
]
