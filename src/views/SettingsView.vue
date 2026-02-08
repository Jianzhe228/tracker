<script setup lang="ts">
import { computed, ref } from 'vue';

import { useSettingsStore } from '../stores/settingsStore';

const settingsStore = useSettingsStore();
const activeTab = ref<'timer' | 'sync' | 'notifications' | 'data'>('timer');

const focus = computed({
  get: () => settingsStore.pomodoro.focusMinutes,
  set: (value: number) => settingsStore.updatePomodoro({ focusMinutes: value })
});

const shortBreak = computed({
  get: () => settingsStore.pomodoro.shortBreakMinutes,
  set: (value: number) => settingsStore.updatePomodoro({ shortBreakMinutes: value })
});

const longBreak = computed({
  get: () => settingsStore.pomodoro.longBreakMinutes,
  set: (value: number) => settingsStore.updatePomodoro({ longBreakMinutes: value })
});

const webdavUrl = ref('');
const webdavUsername = ref('');
const webdavPassword = ref('');
const webdavPath = ref('/tracker/');
const syncStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');

function testConnection(): void {
  syncStatus.value = 'testing';
  setTimeout(() => {
    syncStatus.value = 'success';
  }, 1500);
}
</script>

<template>
  <div class="h-full p-6">
    <!-- Page Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">设置</h1>
      <p class="mt-1 text-sm text-slate-500">自定义你的专注体验</p>
    </div>

    <div class="flex gap-6">
      <!-- Settings Navigation -->
      <nav class="w-48 space-y-1">
        <button
          v-for="tab in [
            { key: 'timer', label: '番茄钟', icon: 'timer' },
            { key: 'sync', label: '云同步', icon: 'sync' },
            { key: 'notifications', label: '通知', icon: 'notifications' },
            { key: 'data', label: '数据管理', icon: 'data' }
          ]"
          :key="tab.key"
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors"
          :class="activeTab === tab.key
            ? 'bg-blue-50 text-blue-600'
            : 'text-slate-600 hover:bg-slate-100'"
          @click="activeTab = tab.key as typeof activeTab"
        >
          <svg v-if="tab.icon === 'timer'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <svg v-else-if="tab.icon === 'sync'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <svg v-else-if="tab.icon === 'notifications'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <svg v-else-if="tab.icon === 'data'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          {{ tab.label }}
        </button>
      </nav>

      <!-- Settings Content -->
      <div class="flex-1">
        <!-- Timer Settings -->
        <div v-if="activeTab === 'timer'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">番茄钟时长</h2>
            <div class="grid gap-6 sm:grid-cols-3">
              <label class="space-y-2">
                <span class="text-sm font-medium text-slate-700">专注时长（分钟）</span>
                <input
                  v-model.number="focus"
                  type="number"
                  min="1"
                  max="120"
                  class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <label class="space-y-2">
                <span class="text-sm font-medium text-slate-700">短休息（分钟）</span>
                <input
                  v-model.number="shortBreak"
                  type="number"
                  min="1"
                  max="30"
                  class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <label class="space-y-2">
                <span class="text-sm font-medium text-slate-700">长休息（分钟）</span>
                <input
                  v-model.number="longBreak"
                  type="number"
                  min="1"
                  max="60"
                  class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">自动化设置</h2>
            <div class="space-y-4">
              <label class="flex items-center justify-between">
                <div>
                  <span class="text-sm font-medium text-slate-700">自动开始休息</span>
                  <p class="text-xs text-slate-500">专注结束后自动开始休息计时</p>
                </div>
                <button class="relative h-6 w-11 rounded-full bg-slate-200 transition-colors">
                  <span class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform" />
                </button>
              </label>

              <label class="flex items-center justify-between">
                <div>
                  <span class="text-sm font-medium text-slate-700">自动开始下一个番茄</span>
                  <p class="text-xs text-slate-500">休息结束后自动开始新的专注</p>
                </div>
                <button class="relative h-6 w-11 rounded-full bg-slate-200 transition-colors">
                  <span class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform" />
                </button>
              </label>
            </div>
          </section>
        </div>

        <!-- Sync Settings -->
        <div v-else-if="activeTab === 'sync'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">WebDAV 云同步</h2>
            <p class="mb-4 text-sm text-slate-500">
              配置 WebDAV 服务器以在多设备间同步你的数据。支持坚果云、Nextcloud 等服务。
            </p>

            <div class="space-y-4">
              <label class="block">
                <span class="mb-1 block text-sm font-medium text-slate-700">服务器地址</span>
                <input
                  v-model="webdavUrl"
                  type="url"
                  placeholder="https://dav.example.com/webdav/"
                  class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <div class="grid gap-4 sm:grid-cols-2">
                <label class="block">
                  <span class="mb-1 block text-sm font-medium text-slate-700">用户名</span>
                  <input
                    v-model="webdavUsername"
                    type="text"
                    class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </label>

                <label class="block">
                  <span class="mb-1 block text-sm font-medium text-slate-700">密码</span>
                  <input
                    v-model="webdavPassword"
                    type="password"
                    class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </label>
              </div>

              <label class="block">
                <span class="mb-1 block text-sm font-medium text-slate-700">同步路径</span>
                <input
                  v-model="webdavPath"
                  type="text"
                  class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <div class="flex items-center gap-4 pt-2">
                <button
                  class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  @click="testConnection"
                >
                  {{ syncStatus === 'testing' ? '测试中...' : '测试连接' }}
                </button>
                <span v-if="syncStatus === 'success'" class="flex items-center gap-1 text-sm text-green-600">
                  <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  连接成功
                </span>
              </div>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">同步操作</h2>
            <div class="flex flex-wrap gap-3">
              <button class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                立即同步
              </button>
              <button class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                上传到云端
              </button>
              <button class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                从云端下载
              </button>
            </div>
            <p class="mt-4 text-xs text-slate-500">
              最后同步时间：从未同步
            </p>
          </section>
        </div>

        <!-- Notifications Settings -->
        <div v-else-if="activeTab === 'notifications'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">通知设置</h2>
            <div class="space-y-4">
              <label class="flex items-center justify-between">
                <div>
                  <span class="text-sm font-medium text-slate-700">番茄钟开始通知</span>
                  <p class="text-xs text-slate-500">开始专注时发送通知</p>
                </div>
                <button class="relative h-6 w-11 rounded-full bg-blue-600 transition-colors">
                  <span class="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform" />
                </button>
              </label>

              <label class="flex items-center justify-between">
                <div>
                  <span class="text-sm font-medium text-slate-700">番茄钟结束通知</span>
                  <p class="text-xs text-slate-500">专注结束时发送通知</p>
                </div>
                <button class="relative h-6 w-11 rounded-full bg-blue-600 transition-colors">
                  <span class="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform" />
                </button>
              </label>

              <label class="flex items-center justify-between">
                <div>
                  <span class="text-sm font-medium text-slate-700">休息结束通知</span>
                  <p class="text-xs text-slate-500">休息结束时发送通知</p>
                </div>
                <button class="relative h-6 w-11 rounded-full bg-blue-600 transition-colors">
                  <span class="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform" />
                </button>
              </label>

              <label class="flex items-center justify-between">
                <div>
                  <span class="text-sm font-medium text-slate-700">任务截止提醒</span>
                  <p class="text-xs text-slate-500">任务即将截止时发送提醒</p>
                </div>
                <button class="relative h-6 w-11 rounded-full bg-slate-200 transition-colors">
                  <span class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform" />
                </button>
              </label>
            </div>
          </section>
        </div>

        <!-- Data Management -->
        <div v-else-if="activeTab === 'data'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">数据导出</h2>
            <p class="mb-4 text-sm text-slate-500">
              导出你的所有数据，包括任务、习惯、专注记录等。
            </p>
            <div class="flex gap-3">
              <button class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                导出为 JSON
              </button>
              <button class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                导出为 CSV
              </button>
            </div>
          </section>

          <section class="rounded-xl border border-red-200 bg-red-50 p-6">
            <h2 class="mb-2 text-lg font-semibold text-red-800">危险区域</h2>
            <p class="mb-4 text-sm text-red-600">
              以下操作不可撤销，请谨慎操作。
            </p>
            <button class="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
              清空所有数据
            </button>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
