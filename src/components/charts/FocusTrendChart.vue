<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { DailyTotal } from '../../types/domain';
import { formatMinutes } from '../../utils/date';

const props = defineProps<{
  data: DailyTotal[];
  compact?: boolean;
}>();

const option = computed(() => ({
  tooltip: {
    trigger: 'axis',
    formatter: (params: { name: string; value: number }[]) => {
      const p = params[0];
      return `${p.name}<br/>专注 ${formatMinutes(Math.round(p.value))}`;
    },
  },
  grid: {
    top: props.compact ? 10 : 30,
    right: 16,
    bottom: props.compact ? 24 : 30,
    left: 48,
  },
  xAxis: {
    type: 'category',
    data: props.data.map(d => d.date.slice(5)),
    axisLabel: { fontSize: 11, color: '#94a3b8' },
    axisLine: { lineStyle: { color: '#e2e8f0' } },
  },
  yAxis: {
    type: 'value',
    name: props.compact ? '' : '分钟',
    nameTextStyle: { color: '#94a3b8', fontSize: 11 },
    axisLabel: { fontSize: 11, color: '#94a3b8' },
    splitLine: { lineStyle: { color: '#f1f5f9' } },
  },
  series: [{
    type: 'line',
    data: props.data.map(d => Math.round(d.totalSeconds / 60)),
    smooth: true,
    symbol: 'circle',
    symbolSize: 6,
    lineStyle: { width: 2, color: '#3b82f6' },
    itemStyle: { color: '#3b82f6' },
    areaStyle: {
      color: {
        type: 'linear',
        x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: 'rgba(59,130,246,0.2)' },
          { offset: 1, color: 'rgba(59,130,246,0.01)' },
        ],
      },
    },
  }],
}));
</script>

<template>
  <VChart
    :option="option"
    autoresize
    :style="{ height: compact ? '180px' : '280px', width: '100%' }"
  />
</template>
