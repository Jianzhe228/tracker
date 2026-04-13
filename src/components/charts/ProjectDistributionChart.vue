<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { ProjectTimeStat } from '../../types/domain';
import { formatMinutes } from '../../utils/date';

const props = defineProps<{
  data: ProjectTimeStat[];
}>();

const option = computed(() => {
  const items = props.data.length > 0
    ? props.data
    : [{ projectTitle: '暂无数据', totalSeconds: 1, sessionCount: 0, projectId: null }];

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}<br/>${formatMinutes(Math.round(params.value))} · ${params.percent}%`,
    },
    legend: {
      orient: 'vertical' as const,
      right: 16,
      top: 'center',
      textStyle: { fontSize: 12, color: '#475569' },
    },
    series: [{
      type: 'pie',
      radius: ['45%', '70%'],
      center: ['35%', '50%'],
      avoidLabelOverlap: true,
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: 'bold' },
      },
      data: items.map(d => ({
        name: d.projectTitle,
        value: Math.round(d.totalSeconds / 60),
      })),
    }],
  };
});
</script>

<template>
  <VChart :option="option" autoresize style="height: 280px; width: 100%" />
</template>
