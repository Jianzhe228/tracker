import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '../views/DashboardView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Dashboard - 仪表盘首页 (eagerly loaded — default route should not be lazy)
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView
    },
    // Smart Lists - 智能列表（任务筛选视图）
    {
      path: '/tasks/today',
      name: 'today',
      component: () => import('../views/TasksView.vue'),
      props: { filter: 'today' }
    },
    {
      path: '/tasks/all',
      name: 'all',
      component: () => import('../views/TasksView.vue'),
      props: { filter: 'all' }
    },
    // Projects - 清单视图
    {
      path: '/project/:id',
      name: 'project',
      component: () => import('../views/TasksView.vue'),
      props: true
    },
    // Settings - 设置
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue')
    }
  ]
});

export default router;
