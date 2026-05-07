<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { DayHourDistributionEntry } from '../../types/domain';
import { toDateKey, formatMinutes } from '../../utils/date';

const props = defineProps<{
  data: DayHourDistributionEntry[];
  /** Total days fetched (Y axis range). Defaults to 14, capped at 90. */
  days?: number;
  /** Visible rows in the default zoom window. */
  visibleRows?: number;
}>();

const hourCategories = Array.from({ length: 24 }, (_value, hour) => hour);

const totalDays = computed(() => {
  const value = props.days ?? 14;
  return Math.min(90, Math.max(7, value));
});

const visibleRows = computed(() => Math.min(props.visibleRows ?? 14, totalDays.value));

const dayKeys = computed(() => {
  const today = new Date();
  const keys: string[] = [];
  for (let i = 0; i < totalDays.value; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    keys.push(toDateKey(day));
  }
  return keys;
});

function formatDayLabel(dateKey: string, index: number): string {
  if (index === 0) return '今天';
  if (index === 1) return '昨天';
  const date = new Date(dateKey);
  if (Number.isNaN(date.getTime())) return dateKey;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatPomodoros(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const dayLabels = computed(() => dayKeys.value.map((key, index) => formatDayLabel(key, index)));

const entryMap = computed(() => {
  const map = new Map<string, DayHourDistributionEntry>();
  for (const entry of props.data) {
    map.set(`${entry.date}-${entry.hour}`, entry);
  }
  return map;
});

const visualMaxMinutes = computed(() => {
  const nonZero = props.data
    .map(entry => Math.round(entry.totalSeconds / 60))
    .filter(minutes => minutes > 0)
    .sort((left, right) => left - right);

  if (nonZero.length === 0) return 5;

  if (nonZero.length <= 4) {
    return Math.max(5, Math.max(...nonZero));
  }

  const p90Index = Math.floor((nonZero.length - 1) * 0.9);
  const p90 = nonZero[p90Index];
  return Math.max(10, Math.ceil(p90 / 5) * 5);
});

const heatmapData = computed(() => {
  const rows: number[][] = [];

  for (let dayIndex = 0; dayIndex < dayKeys.value.length; dayIndex++) {
    const dateKey = dayKeys.value[dayIndex];
    for (const hour of hourCategories) {
      const entry = entryMap.value.get(`${dateKey}-${hour}`);
      const minutes = entry ? Math.round(entry.totalSeconds / 60) : 0;
      const visualMinutes = minutes > 0 ? Math.max(2, minutes) : 0;
      rows.push([
        hour,
        dayIndex,
        minutes,
        entry?.sessionCount || 0,
        entry?.pomodoroCount || 0,
        dayIndex,
        visualMinutes,
      ]);
    }
  }

  return rows;
});

// Height stays bounded — the user pans through extra days via dataZoom rather
// than scrolling a giant canvas.
const chartHeight = computed(() => {
  return `${Math.max(280, visibleRows.value * 22 + 100)}px`;
});

// Default zoom window: most recent N days at top (Y axis is inverted).
const yZoomEndPercent = computed(() => {
  if (totalDays.value <= 1) return 100;
  return Math.min(100, ((visibleRows.value - 1) / (totalDays.value - 1)) * 100);
});

const option = computed(() => ({
  animation: false,
  animationThreshold: 2000,
  progressive: 0,
  hoverLayerThreshold: Infinity,
  tooltip: {
    show: true,
    formatter: (params: { data: number[] }) => {
      const d = params.data;
      if (!d || d[2] === 0) return '';
      const dateKey = dayKeys.value[d[1]];
      const label = formatDayLabel(dateKey, d[1]);
      return `${label} ${d[0]}:00–${d[0] + 1}:00<br/>${formatMinutes(d[2])} · ${d[3]} 次 · ${formatPomodoros(d[4])} 番茄`;
    },
  },
  grid: {
    top: 36,
    right: 28,
    bottom: 20,
    left: 72,
  },
  xAxis: {
    type: 'category',
    position: 'top',
    data: hourCategories,
    axisLabel: {
      color: '#64748b',
      fontSize: 10,
      formatter: (value: number) => (value % 2 === 0 ? `${value}:00` : ''),
    },
    axisTick: { show: false },
    axisLine: {
      lineStyle: { color: '#e2e8f0' },
    },
  },
  yAxis: {
    type: 'category',
    inverse: true,
    data: dayLabels.value,
    axisLabel: {
      color: '#64748b',
      fontSize: 10,
    },
    axisTick: { show: false },
    axisLine: {
      lineStyle: { color: '#e2e8f0' },
    },
  },
  dataZoom: [
    {
      // Vertical wheel scroll pans through dates (Y axis is dates).
      type: 'inside',
      yAxisIndex: 0,
      start: 0,
      end: yZoomEndPercent.value,
      zoomOnMouseWheel: false,
      moveOnMouseWheel: true,
      moveOnMouseMove: false,
      filterMode: 'none',
      orient: 'vertical',
    },
    {
      type: 'slider',
      yAxisIndex: 0,
      start: 0,
      end: yZoomEndPercent.value,
      width: 10,
      right: 6,
      top: 36,
      bottom: 20,
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
      showDataShadow: false,
      brushSelect: false,
      orient: 'vertical',
    },
  ],
  visualMap: {
    show: false,
    dimension: 6,
    min: 0,
    max: visualMaxMinutes.value,
    calculable: false,
    inRange: {
      color: ['#FAFAF8', '#E2E6FA', '#C4CBF5', '#9EA8EC', '#7A86E3', '#5C69D8'],
    },
  },
  series: [
    {
      name: 'dayHourDistribution',
      type: 'heatmap',
      encode: {
        x: 0,
        y: 1,
        value: 6,
      },
      data: heatmapData.value,
      label: {
        show: false,
      },
      itemStyle: {
        borderColor: '#e5e7eb',
        borderWidth: 1,
      },
      silent: false,
    },
  ],
}));
</script>

<template>
  <VChart
    :option="option"
    autoresize
    :style="{ height: chartHeight, width: '100%' }"
  />
</template>
