<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { WeeklyFocusStat } from '../../types/domain';

const props = defineProps<{
  data: WeeklyFocusStat[];
  /** Default visible weeks in the zoom window (most recent). */
  defaultWindow?: number;
}>();

function formatPomodoros(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatHours(hours: number): string {
  if (hours >= 10) return `${hours.toFixed(0)}h`;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours * 60)}m`;
}

const total = computed(() => props.data.length);
const defaultWindow = computed(() => Math.min(props.defaultWindow ?? 8, total.value));
const startPercent = computed(() => {
  if (total.value <= 1) return 0;
  return Math.max(0, ((total.value - defaultWindow.value) / (total.value - 1)) * 100);
});

const option = computed(() => {
  const d = props.data;
  if (!d.length) return {};

  const weeks = d.map(w => {
    // Format: "3/17" from "2026-03-17"
    const [, m, day] = w.weekStart.split('-');
    return `${Number(m)}/${Number(day)}`;
  });
  const hours = d.map(w => +(w.totalSeconds / 3600).toFixed(2));

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(92,105,216,0.06)' } },
      formatter: (params: any) => {
        const p = params[0];
        const w = d[p.dataIndex];
        const h = (w.totalSeconds / 3600).toFixed(1);
        return `${w.weekStart} 起<br/>${h} 小时 · ${w.sessionCount} 次 · ${formatPomodoros(w.pomodoroCount)} 番茄`;
      },
    },
    grid: { left: 44, right: 12, top: 16, bottom: 36 },
    xAxis: {
      type: 'category',
      data: weeks,
      axisLabel: { color: '#94a3b8', fontSize: 11, hideOverlap: true },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        formatter: (value: number) => formatHours(value),
      },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        start: startPercent.value,
        end: 100,
        zoomOnMouseWheel: true,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
        filterMode: 'filter',
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        start: startPercent.value,
        end: 100,
        height: 12,
        bottom: 4,
        borderColor: 'transparent',
        backgroundColor: '#F5F6FA',
        fillerColor: 'rgba(92,105,216,0.18)',
        handleSize: 12,
        handleStyle: {
          color: '#FFFFFF',
          borderColor: '#5C69D8',
          borderWidth: 1.5,
        },
        moveHandleSize: 4,
        moveHandleStyle: { color: '#5C69D8', opacity: 0.6 },
        showDetail: false,
        brushSelect: false,
      },
    ],
    series: [{
      type: 'bar',
      data: hours,
      barMaxWidth: 28,
      itemStyle: {
        color: '#5C69D8',
        borderRadius: [4, 4, 0, 0],
      },
      emphasis: { itemStyle: { color: '#4B55C4' } },
    }],
  };
});
</script>

<template>
  <VChart v-if="data.length" class="h-[220px] w-full" :option="option" autoresize />
  <div v-else class="flex h-[220px] items-center justify-center rounded-lg bg-surface-hover text-sm text-[#9E9E9A]">暂无数据</div>
</template>
