import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'downloads',
    component: () => import('../views/Downloads.vue'),
  },
  {
    path: '/usenet',
    name: 'usenet-history',
    component: () => import('../views/UsenetHistory.vue'),
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
