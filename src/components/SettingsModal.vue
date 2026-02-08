<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSettingsStore } from '../stores/settingsStore';

const emit = defineEmits<{
  close: []
}>();

const settingsStore = useSettingsStore();
const activeTab = ref('pomodoro');

const tabs = [
  { key: 'account', label: '账户', icon: 'user' },
  { key: 'general', label: '通用', icon: 'sliders' },
  { key: 'pomodoro', label: '番茄钟', icon: 'clock' },
  { key: 'projects', label: '清单管理', icon: 'folder' },
  { key: 'appearance', label: '外观', icon: 'palette' },
  { key: 'about', label: '关于', icon: 'info' },
];

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

const autoStartBreak = ref(false);
const autoStartPomodoro = ref(false);
const disableBreak = ref(false);
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('close')">
      <div class="flex h-[70vh] w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <!-- Sidebar -->
        <nav class="w-48 border-r border-slate-200 p-4">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors"
            :class="activeTab === tab.key
              ? 'bg-slate-100 text-slate-900'
              : 'text-slate-600 hover:bg-slate-50'"
            @click="activeTab = tab.key"
          >
            <svg v-if="tab.icon === 'user'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <svg v-else-if="tab.icon === 'sliders'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <svg v-else-if="tab.icon === 'clock'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <svg v-else-if="tab.icon === 'folder'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <svg v-else-if="tab.icon === 'palette'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            <svg v-else-if="tab.icon === 'info'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {{ tab.label }}
          </button>
        </nav>

        <!-- Content -->
        <div class="flex flex-1 flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-slate-800">设置</h2>
            <button
              class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              @click="emit('close')"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Settings Content -->
          <div class="flex-1 overflow-auto p-6">
            <template v-if="activeTab === 'pomodoro'">
              <div class="space-y-6">
                <!-- Time Settings -->
                <div class="space-y-4">
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-slate-700">专注时长</span>
                    <select
                      v-model.number="focus"
                      class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option v-for="m in [15, 20, 25, 30, 45, 60]" :key="m" :value="m">{{ m }} 分钟</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-slate-700">短休息时长</span>
                    <select
                      v-model.number="shortBreak"
                      class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option v-for="m in [3, 5, 10, 15]" :key="m" :value="m">{{ m }} 分钟</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-slate-700">长休息时长</span>
                    <select
                      v-model.number="longBreak"
                      class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option v-for="m in [10, 15, 20, 30]" :key="m" :value="m">{{ m }} 分钟</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-slate-700">长休息间隔</span>
                    <select class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                      <option value="4">4 个番茄后</option>
                      <option value="3">3 个番茄后</option>
                      <option value="5">5 个番茄后</option>
                    </select>
                  </div>
                </div>

                <hr class="border-slate-200" />

                <!-- Toggle Settings -->
                <div class="space-y-4">
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-slate-700">自动开始下一个番茄</span>
                    <button
                      class="relative h-6 w-11 rounded-full transition-colors"
                      :class="autoStartPomodoro ? 'bg-blue-600' : 'bg-slate-200'"
                      @click="autoStartPomodoro = !autoStartPomodoro"
                    >
                      <span
                        class="absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform"
                        :class="autoStartPomodoro ? 'right-1' : 'left-1'"
                      />
                    </button>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-slate-700">自动开始休息</span>
                    <button
                      class="relative h-6 w-11 rounded-full transition-colors"
                      :class="autoStartBreak ? 'bg-blue-600' : 'bg-slate-200'"
                      @click="autoStartBreak = !autoStartBreak"
                    >
                      <span
                        class="absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform"
                        :class="autoStartBreak ? 'right-1' : 'left-1'"
                      />
                    </button>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-slate-700">禁用休息</span>
                    <button
                      class="relative h-6 w-11 rounded-full transition-colors"
                      :class="disableBreak ? 'bg-blue-600' : 'bg-slate-200'"
                      @click="disableBreak = !disableBreak"
                    >
                      <span
                        class="absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform"
                        :class="disableBreak ? 'right-1' : 'left-1'"
                      />
                    </button>
                  </div>
                </div>

                <hr class="border-slate-200" />

                <!-- Alarm Sound -->
                <div class="flex items-center justify-between">
                  <span class="text-sm text-slate-700">提示音</span>
                  <select class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                    <option>默认</option>
                    <option>铃声</option>
                    <option>电子音</option>
                  </select>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="flex h-full items-center justify-center text-slate-400">
                <p>{{ tabs.find(t => t.key === activeTab)?.label }} 设置即将推出...</p>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
