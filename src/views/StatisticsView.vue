<script setup lang="ts">
import { ref } from 'vue';

type TabType = 'overview' | 'focus' | 'tasks';
const activeTab = ref<TabType>('overview');
const dateRange = ref('14d');

const tabs: { key: TabType; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'focus', label: '专注分析' },
  { key: 'tasks', label: '任务分析' }
];

// TODO: Replace with real data from store
const hasData = ref(false);
</script>

<template>
  <div class="h-full p-6">
    <!-- Page Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">统计分析</h1>
      <p class="mt-1 text-sm text-slate-500">查看你的专注数据和工作模式</p>
    </div>

    <!-- Filter Bar -->
    <div class="mb-6 flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <div class="flex items-center gap-2">
        <label class="text-sm font-medium text-slate-600">时间范围</label>
        <select
          v-model="dateRange"
          class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="7d">近 7 天</option>
          <option value="14d">近 14 天</option>
          <option value="30d">近 30 天</option>
          <option value="custom">自定义</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <label class="text-sm font-medium text-slate-600">清单</label>
        <select class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="all">全部</option>
        </select>
      </div>
      <button class="ml-auto text-sm text-slate-500 hover:text-slate-700">
        重置筛选
      </button>
    </div>

    <!-- Tabs -->
    <div class="mb-6 border-b border-slate-200">
      <nav class="-mb-px flex gap-6">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="border-b-2 pb-3 text-sm font-medium transition-colors"
          :class="activeTab === tab.key
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <!-- Tab Content -->
    <div class="space-y-6">
      <!-- Overview Tab -->
      <template v-if="activeTab === 'overview'">
        <!-- KPI Cards -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <svg class="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p class="text-sm text-slate-500">总专注时长</p>
                <p class="text-xl font-semibold text-slate-800">0 分钟</p>
              </div>
            </div>
          </article>

          <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                <svg class="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p class="text-sm text-slate-500">完成番茄数</p>
                <p class="text-xl font-semibold text-slate-800">0 个</p>
              </div>
            </div>
          </article>

          <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                <svg class="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <p class="text-sm text-slate-500">完成任务数</p>
                <p class="text-xl font-semibold text-slate-800">0 个</p>
              </div>
            </div>
          </article>

        </div>

        <!-- Charts Placeholder -->
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">专注趋势</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无专注数据</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">任务完成趋势</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无任务数据</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h3 class="mb-4 font-semibold text-slate-800">时段效率摘要</h3>
            <div class="flex h-32 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>
        </div>
      </template>

      <!-- Focus Tab -->
      <template v-else-if="activeTab === 'focus'">
        <div class="grid gap-6 lg:grid-cols-2">
          <!-- Hourly Distribution Chart -->
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h3 class="mb-4 font-semibold text-slate-800">时段效率分布</h3>
            <div class="flex h-64 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无专注记录</p>
            </div>
          </div>

          <!-- Weekly/Monthly Trend -->
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">每周趋势</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>

          <!-- Pomodoro Timeline -->
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">番茄时间轴</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>
        </div>
      </template>

      <!-- Tasks Tab -->
      <template v-else-if="activeTab === 'tasks'">
        <div class="grid gap-6 lg:grid-cols-2">
          <!-- Task Completion Rate -->
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">任务完成率</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无任务数据</p>
            </div>
          </div>

          <!-- Estimated vs Actual -->
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">预估 vs 实际</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>

          <!-- Tag/Project Distribution -->
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h3 class="mb-4 font-semibold text-slate-800">标签/清单分布</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>
