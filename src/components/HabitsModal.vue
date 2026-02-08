<script setup lang="ts">
import { ref } from 'vue';
import { useHabitStore } from '../stores/habitStore';

const emit = defineEmits<{
  close: []
}>();

const habitStore = useHabitStore();
const newHabitName = ref('');

function addHabit() {
  if (!newHabitName.value.trim()) return;
  habitStore.addHabit(newHabitName.value.trim());
  newHabitName.value = '';
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('close')">
      <div class="flex h-[70vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 class="text-lg font-semibold text-slate-800">习惯打卡</h2>
          <button
            class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            @click="emit('close')"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-auto p-6">
          <!-- Progress Card -->
          <div class="mb-6 rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 p-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold text-slate-800">今日进度</h3>
                <p class="mt-1 text-sm text-slate-500">
                  已完成 {{ habitStore.habits.filter(h => h.checkedToday).length }} / {{ habitStore.habits.length }} 个习惯
                </p>
              </div>
              <div class="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
                <span class="text-xl font-bold text-green-600">
                  {{ habitStore.habits.length > 0 ? Math.round((habitStore.habits.filter(h => h.checkedToday).length / habitStore.habits.length) * 100) : 0 }}%
                </span>
              </div>
            </div>
          </div>

          <!-- Add Habit -->
          <div class="mb-4 flex gap-2">
            <input
              v-model="newHabitName"
              type="text"
              placeholder="输入习惯名称，按 Enter 添加"
              class="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              @keyup.enter="addHabit"
            />
            <button
              class="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              @click="addHabit"
            >
              添加
            </button>
          </div>

          <!-- Habits List -->
          <div class="space-y-2">
            <div
              v-for="habit in habitStore.habits"
              :key="habit.id"
              class="flex items-center justify-between rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50"
            >
              <div class="flex items-center gap-3">
                <button
                  class="flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                  :class="habit.checkedToday
                    ? 'bg-green-500 text-white'
                    : 'border-2 border-slate-300 text-slate-300 hover:border-green-400'"
                  @click="habitStore.checkHabit(habit.id)"
                >
                  <svg v-if="habit.checkedToday" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                </button>
                <span class="text-sm text-slate-700">{{ habit.name }}</span>
              </div>
              <span class="text-xs text-slate-400">每日</span>
            </div>

            <div v-if="habitStore.habits.length === 0" class="py-8 text-center">
              <svg class="mx-auto h-12 w-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              <p class="mt-2 text-sm text-slate-500">还没有习惯，添加一个开始吧</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
