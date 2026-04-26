<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { WeeklyFocusStat } from '../../types/domain';

const props = defineProps<{ data: WeeklyFocusStat[] }>();

function formatPomodoros(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const option = computed(() => {
  const d = props.data;
  if (!d.length) return {};

  const weeks = d.map(w => {
    // Format: "3/17" from "2026-03-17"
    const [, m, day] = w.weekStart.split('-');
    return `${Number(m)}/${Number(day)}`;
  });
  const hours = d.map(w => +(w.totalSeconds / 3600).toFixed(1));

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = params[0];
        const w = d[p.dataIndex];
        const h = (w.totalSeconds / 3600).toFixed(1);
        return `${w.weekStart} 起<br/>${h} 小时 · ${w.sessionCount} 次 · ${formatPomodoros(w.pomodoroCount)} 番茄`;
      },
    },
    grid: { left: 40, right: 12, top: 16, bottom: 24 },
    xAxis: {
      type: 'category',
      data: weeks,
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '{value}h' },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    series: [{
      type: 'bar',
      data: hours,
      barMaxWidth: 28,
      itemStyle: {
        color: '#3b82f6',
        borderRadius: [4, 4, 0, 0],
      },
      emphasis: { itemStyle: { color: '#2563eb' } },
    }],
  };
});
</script>

<template>
  <VChart v-if="data.length" class="h-[200px] w-full" :option="option" autoresize />
  <div v-else class="flex h-[200px] items-center justify-center rounded-lg bg-surface-hover text-sm text-[#9E9E9A]">暂无数据</div>
</template>
