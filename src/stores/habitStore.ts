import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { HabitItem } from '../types/domain';

export const useHabitStore = defineStore('habit', () => {
  const habits = ref<HabitItem[]>([]);

  function addHabit(name: string): void {
    habits.value.unshift({
      id: Date.now(),
      name,
      checkedToday: false
    });
  }

  function checkHabit(id: number): void {
    const target = habits.value.find((habit) => habit.id === id);
    if (!target) return;
    target.checkedToday = !target.checkedToday;
  }

  return {
    habits,
    addHabit,
    checkHabit
  };
});
