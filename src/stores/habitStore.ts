import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { HabitItem } from '../types/domain';
import { createHabit as createHabitCmd, toggleHabitCheck, deleteHabit as deleteHabitCmd } from '../services/commands/habit';

const isTauri = '__TAURI_INTERNALS__' in window;

export const useHabitStore = defineStore('habit', () => {
  const habits = ref<HabitItem[]>([]);

  function loadFromData(rows: HabitItem[]): void {
    habits.value = rows;
  }

  async function addHabit(title: string): Promise<void> {
    const id = Date.now();
    const now = new Date().toISOString();
    const habit: HabitItem = {
      id,
      title,
      description: null,
      icon: null,
      color: null,
      type: 'boolean',
      targetValue: 1,
      targetUnit: null,
      frequencyType: 'daily',
      frequencyValue: null,
      frequencyDays: null,
      maxSkipsPerMonth: 3,
      reminderEnabled: false,
      reminderTime: null,
      archived: false,
      checkedToday: false,
      createdAt: now,
      updatedAt: now,
    };
    habits.value.unshift(habit);
    if (isTauri) {
      await createHabitCmd({ id, title }).catch(console.error);
    }
  }

  async function checkHabit(id: number): Promise<void> {
    const target = habits.value.find((habit) => habit.id === id);
    if (!target) return;
    target.checkedToday = !target.checkedToday;
    if (isTauri) {
      await toggleHabitCheck(id).catch(console.error);
    }
  }

  async function removeHabit(id: number): Promise<void> {
    habits.value = habits.value.filter((habit) => habit.id !== id);
    if (isTauri) {
      await deleteHabitCmd(id).catch(console.error);
    }
  }

  return {
    habits,
    loadFromData,
    addHabit,
    checkHabit,
    removeHabit
  };
});
