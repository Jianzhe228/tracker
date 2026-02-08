<script setup lang="ts">
import { ref, computed } from 'vue';
import { useHabitStore } from '../stores/habitStore';

const habitStore = useHabitStore();
const newHabitName = ref('');
const selectedHabitId = ref<number | null>(null);

// Selected habit
const selectedHabit = computed(() => {
  if (!selectedHabitId.value) return null;
  return habitStore.habits.find(h => h.id === selectedHabitId.value) || null;
});

// Stats
const completedCount = computed(() => habitStore.habits.filter(h => h.checkedToday).length);
const totalCount = computed(() => habitStore.habits.length);
const completionRate = computed(() => {
  if (totalCount.value === 0) return 0;
  return Math.round((completedCount.value / totalCount.value) * 100);
});

function addHabit() {
  if (!newHabitName.value.trim()) return;
  habitStore.addHabit(newHabitName.value.trim());
  newHabitName.value = '';
}

function selectHabit(habitId: number) {
  selectedHabitId.value = selectedHabitId.value === habitId ? null : habitId;
}

function closeDetail() {
  selectedHabitId.value = null;
}
</script>

<template>
  <div class="flex h-full">
    <!-- Main Habit List -->
    <div class="flex flex-1 flex-col">
      <!-- Header -->
      <div class="border-b border-slate-200 bg-white px-6 py-4">
        <div class="flex items-center justify-between">
          <h1 class="text-xl font-semibold text-slate-800">习惯打卡</h1>
          <button class="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </div>

        <!-- Stats Bar -->
        <div class="mt-4 grid grid-cols-3 gap-4 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 p-4">
          <div class="text-center">
            <div class="text-2xl font-semibold text-green-600">{{ completedCount }}<span class="text-sm text-slate-400">/{{ totalCount }}</span></div>
            <div class="text-xs text-slate-500">今日完成</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-semibold text-green-600">{{ completionRate }}%</div>
            <div class="text-xs text-slate-500">完成率</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-semibold text-amber-500">0</div>
            <div class="text-xs text-slate-500">连续天数</div>
          </div>
        </div>
      </div>

      <!-- Habit Input -->
      <div class="border-b border-slate-200 bg-white px-6 py-3">
        <div class="flex items-center gap-3">
          <svg class="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <input
            v-model="newHabitName"
            type="text"
            placeholder="添加习惯，按「Enter」保存"
            class="flex-1 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none"
            @keyup.enter="addHabit"
          />
          <select class="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 focus:outline-none">
            <option>每日</option>
            <option>每周</option>
            <option>每月</option>
          </select>
        </div>
      </div>

      <!-- Habit List -->
      <div class="flex-1 overflow-auto bg-slate-50 p-6">
        <div v-if="habitStore.habits.length > 0" class="space-y-2">
          <div
            v-for="habit in habitStore.habits"
            :key="habit.id"
            class="group flex cursor-pointer items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-sm transition-all hover:shadow"
            :class="selectedHabitId === habit.id ? 'ring-2 ring-green-400' : ''"
            @click="selectHabit(habit.id)"
          >
            <!-- Check Button -->
            <button
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors"
              :class="habit.checkedToday
                ? 'bg-green-500 text-white'
                : 'border-2 border-slate-300 hover:border-green-400'"
              @click.stop="habitStore.checkHabit(habit.id)"
            >
              <svg v-if="habit.checkedToday" class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </button>

            <!-- Habit Name -->
            <span
              class="flex-1 text-sm"
              :class="habit.checkedToday ? 'text-slate-400 line-through' : 'text-slate-700'"
            >
              {{ habit.name }}
            </span>

            <!-- Streak -->
            <div class="flex items-center gap-1 text-xs text-slate-400">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
              </svg>
              <span>0天</span>
            </div>

            <!-- Frequency Badge -->
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">每日</span>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="flex h-full flex-col items-center justify-center">
          <div class="flex h-24 w-24 items-center justify-center rounded-full bg-green-50">
            <svg class="h-12 w-12 text-green-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <p class="mt-4 text-slate-600">暂无习惯</p>
          <p class="mt-1 text-sm text-slate-400">养成好习惯，从今天开始</p>
        </div>
      </div>
    </div>

    <!-- Habit Detail Panel -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="w-0 opacity-0"
      enter-to-class="w-80 opacity-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="w-80 opacity-100"
      leave-to-class="w-0 opacity-0"
    >
      <aside v-if="selectedHabit" class="w-80 border-l border-slate-200 bg-white">
        <div class="flex h-full flex-col">
          <!-- Detail Header -->
          <div class="flex items-center gap-3 border-b border-slate-200 p-4">
            <button
              class="flex h-6 w-6 items-center justify-center rounded-full transition-colors"
              :class="selectedHabit.checkedToday
                ? 'bg-green-500 text-white'
                : 'border-2 border-slate-300'"
              @click="habitStore.checkHabit(selectedHabit.id)"
            >
              <svg v-if="selectedHabit.checkedToday" class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </button>
            <span class="flex-1 font-medium text-slate-800">{{ selectedHabit.name }}</span>
            <button class="text-slate-400 hover:text-slate-600" @click="closeDetail">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Detail Content -->
          <div class="flex-1 overflow-auto p-4">
            <div class="space-y-4">
              <!-- Frequency -->
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-sm text-slate-600">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  频率
                </div>
                <select class="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-600 focus:outline-none">
                  <option>每日</option>
                  <option>每周</option>
                  <option>每月</option>
                </select>
              </div>

              <!-- Reminder -->
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-sm text-slate-600">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  提醒时间
                </div>
                <span class="text-sm text-slate-400">未设置</span>
              </div>

              <!-- Target -->
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-sm text-slate-600">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  目标天数
                </div>
                <span class="text-sm text-slate-500">21天</span>
              </div>

              <hr class="border-slate-200" />

              <!-- Statistics -->
              <div>
                <h3 class="mb-3 text-sm font-medium text-slate-700">打卡统计</h3>
                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-lg bg-green-50 p-3 text-center">
                    <div class="text-xl font-semibold text-green-600">0</div>
                    <div class="text-xs text-slate-500">当前连续</div>
                  </div>
                  <div class="rounded-lg bg-amber-50 p-3 text-center">
                    <div class="text-xl font-semibold text-amber-600">0</div>
                    <div class="text-xs text-slate-500">最长连续</div>
                  </div>
                  <div class="rounded-lg bg-blue-50 p-3 text-center">
                    <div class="text-xl font-semibold text-blue-600">0</div>
                    <div class="text-xs text-slate-500">总打卡</div>
                  </div>
                  <div class="rounded-lg bg-slate-50 p-3 text-center">
                    <div class="text-xl font-semibold text-slate-600">0%</div>
                    <div class="text-xs text-slate-500">完成率</div>
                  </div>
                </div>
              </div>

              <hr class="border-slate-200" />

              <!-- Calendar Preview -->
              <div>
                <h3 class="mb-3 text-sm font-medium text-slate-700">本月记录</h3>
                <div class="rounded-lg border border-slate-100 p-3">
                  <div class="grid grid-cols-7 gap-1 text-center text-xs">
                    <span class="text-slate-400">一</span>
                    <span class="text-slate-400">二</span>
                    <span class="text-slate-400">三</span>
                    <span class="text-slate-400">四</span>
                    <span class="text-slate-400">五</span>
                    <span class="text-slate-400">六</span>
                    <span class="text-red-400">日</span>
                    <span v-for="d in 28" :key="d" class="rounded py-1" :class="d === 8 ? 'bg-green-500 text-white' : 'text-slate-500'">
                      {{ d }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Notes -->
              <div>
                <textarea
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 placeholder:text-slate-400 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  rows="2"
                  placeholder="添加备注..."
                />
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="border-t border-slate-200 p-3">
            <button class="w-full rounded-lg border border-red-200 py-2 text-sm text-red-500 transition-colors hover:bg-red-50">
              删除习惯
            </button>
          </div>
        </div>
      </aside>
    </Transition>
  </div>
</template>
