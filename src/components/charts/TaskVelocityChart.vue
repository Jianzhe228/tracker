<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { WeeklyTaskVelocity } from '../../types/domain';

const props = defineProps<{ data: WeeklyTaskVelocity[] }>();

const option = computed(() => {
  const d = props.data;
  if (!d.length) return {};

  const weeks = d.map(w => {
    const [, m, day] = w.weekStart.split('-');
    return `${Number(m)}/${Number(day)}`;
  });
  const counts = d.map(w => w.completedCount);

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = params[0];
        const w = d[p.dataIndex];
        return `${w.weekStart} 起<br/>完成 ${w.completedCount} 个`;
      },
    },
    grid: { left: 40, right: 12, top: 16, bottom: 24 },
    xAxis: {
      type: 'category',
      data: weeks,
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    series: [{
      type: 'line',
      data: counts,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { color: '#22c55e', width: 2 },
      itemStyle: { color: '#22c55e' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(34,197,94,0.25)' },
            { offset: 1, color: 'rgba(34,197,94,0.02)' },
          ],
        },
      },
    }],
  };
});
</script>

<template>
  <VChart v-if="data.length" class="h-[200px] w-full" :option="option" autoresize />
  <div v-else class="flex h-[200px] items-center justify-center rounded-lg bg-surface-hover text-sm text-[#9E9E9A]">暂无数据</div>
</template>
