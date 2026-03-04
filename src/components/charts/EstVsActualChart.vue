<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { EstimationComparison } from '../../types/domain';

const props = defineProps<{
  data: EstimationComparison[];
}>();

const option = computed(() => {
  const items = props.data.slice(0, 10);
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    legend: {
      data: ['预估', '实际'],
      top: 0,
      textStyle: { fontSize: 12, color: '#475569' },
    },
    grid: {
      top: 36,
      right: 16,
      bottom: 30,
      left: 80,
    },
    yAxis: {
      type: 'category',
      data: items.map(d => d.taskTitle.length > 8 ? d.taskTitle.slice(0, 8) + '...' : d.taskTitle),
      axisLabel: { fontSize: 11, color: '#64748b' },
    },
    xAxis: {
      type: 'value',
      name: '分钟',
      nameTextStyle: { color: '#94a3b8', fontSize: 11 },
      axisLabel: { fontSize: 11, color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    series: [
      {
        name: '预估',
        type: 'bar',
        data: items.map(d => Math.round(d.estimatedSeconds / 60)),
        itemStyle: { color: '#93c5fd', borderRadius: [0, 4, 4, 0] },
        barGap: '10%',
      },
      {
        name: '实际',
        type: 'bar',
        data: items.map(d => Math.round(d.actualSeconds / 60)),
        itemStyle: { color: '#3b82f6', borderRadius: [0, 4, 4, 0] },
      },
    ],
  };
});
</script>

<template>
  <VChart :option="option" autoresize style="height: 280px; width: 100%" />
</template>
