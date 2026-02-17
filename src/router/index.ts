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
      path: '/tasks/tomorrow',
      name: 'tomorrow',
      component: () => import('../views/TasksView.vue'),
      props: { filter: 'tomorrow' }
    },
    {
      path: '/tasks/week',
      name: 'week',
      component: () => import('../views/TasksView.vue'),
      props: { filter: 'week' }
    },
    {
      path: '/tasks/all',
      name: 'all',
      component: () => import('../views/TasksView.vue'),
      props: { filter: 'all' }
    },
    {
      path: '/tasks/completed',
      name: 'completed',
      component: () => import('../views/TasksView.vue'),
      props: { filter: 'completed' }
    },
    // Projects - 清单视图
    {
      path: '/project/:id',
      name: 'project',
      component: () => import('../views/TasksView.vue'),
      props: true
    },
    // Habits - 习惯
    {
      path: '/habits',
      name: 'habits',
      component: () => import('../views/HabitsView.vue')
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
