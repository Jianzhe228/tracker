<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { TaskCompletionStats } from '../../types/domain';

const props = defineProps<{
  data: TaskCompletionStats | null;
}>();

const option = computed(() => {
  const d = props.data ?? { done: 0, todo: 0, cancelled: 0, overdue: 0, total: 0 };
  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}: ${params.value} · ${params.percent}%`,
    },
    legend: {
      orient: 'vertical',
      right: 4,
      top: 'middle',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 10,
      formatter: (name: string) => {
        const map: Record<string, number> = { '已完成': d.done, '待办': d.todo, '已取消': d.cancelled, '已逾期': d.overdue };
        return `${name}  {bold|${map[name] ?? 0}}`;
      },
      textStyle: {
        fontSize: 11,
        color: '#64748b',
        rich: { bold: { fontWeight: 600, fontSize: 12, color: '#1e293b' } },
      },
    },
    series: [{
      type: 'pie',
      radius: ['44%', '70%'],
      center: ['32%', '50%'],
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 13, fontWeight: 'bold' },
        scaleSize: 4,
      },
      data: [
        { name: '已完成', value: d.done, itemStyle: { color: '#22c55e' } },
        { name: '待办', value: d.todo, itemStyle: { color: '#3b82f6' } },
        { name: '已取消', value: d.cancelled, itemStyle: { color: '#94a3b8' } },
        { name: '已逾期', value: d.overdue, itemStyle: { color: '#ef4444' } },
      ].filter(item => item.value > 0),
    }],
  };
});
</script>

<template>
  <VChart :option="option" autoresize style="height: 200px; width: 100%" />
</template>
