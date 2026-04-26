<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { HourlyBucket } from '../../types/domain';
import { formatAxisMinutes, formatMinutes } from '../../utils/date';

const props = defineProps<{
  data: HourlyBucket[];
  compact?: boolean;
}>();

const fullData = computed(() => {
  const map = new Map(props.data.map(d => [d.hour, d]));
  return Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    totalSeconds: map.get(i)?.totalSeconds ?? 0,
    sessionCount: map.get(i)?.sessionCount ?? 0,
  }));
});

const option = computed(() => ({
  tooltip: {
    trigger: 'axis',
    formatter: (params: { name: string; value: number }[]) => {
      const p = params[0];
      return `${p.name}:00 · ${formatMinutes(Math.round(p.value))}`;
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
    data: fullData.value.map(d => String(d.hour)),
    axisLabel: { fontSize: 11, color: '#94a3b8' },
    axisLine: { lineStyle: { color: '#e2e8f0' } },
  },
  yAxis: {
    type: 'value',
    name: props.compact ? '' : '',
    nameTextStyle: { color: '#94a3b8', fontSize: 11 },
    axisLabel: {
      fontSize: 11,
      color: '#94a3b8',
      formatter: (value: number) => formatAxisMinutes(value),
    },
    splitLine: { lineStyle: { color: '#f1f5f9' } },
  },
  series: [{
    type: 'bar',
    data: fullData.value.map(d => Math.round(d.totalSeconds / 60)),
    itemStyle: {
      color: '#8b5cf6',
      borderRadius: [4, 4, 0, 0],
    },
    barMaxWidth: 20,
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
