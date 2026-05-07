<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { WeeklyTaskVelocity } from '../../types/domain';

const props = defineProps<{
  data: WeeklyTaskVelocity[];
  /** Default visible weeks in the zoom window (most recent). */
  defaultWindow?: number;
}>();

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
    const [, m, day] = w.weekStart.split('-');
    return `${Number(m)}/${Number(day)}`;
  });
  const counts = d.map(w => w.completedCount);

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: '#C4CBF5' } },
      formatter: (params: any) => {
        const p = params[0];
        const w = d[p.dataIndex];
        const unit = w.completedCount === 1 ? '个任务' : '个任务';
        return `${w.weekStart} 起<br/>完成 ${w.completedCount} ${unit}`;
      },
    },
    grid: { left: 44, right: 12, top: 16, bottom: 36 },
    xAxis: {
      type: 'category',
      data: weeks,
      axisLabel: { color: '#94a3b8', fontSize: 11, hideOverlap: true },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        formatter: (value: number) => `${value}`,
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
      type: 'line',
      data: counts,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      sampling: 'lttb',
      lineStyle: { color: '#5C69D8', width: 2 },
      itemStyle: { color: '#5C69D8' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(92,105,216,0.18)' },
            { offset: 1, color: 'rgba(92,105,216,0.01)' },
          ],
        },
      },
    }],
  };
});
</script>

<template>
  <VChart v-if="data.length" class="h-[220px] w-full" :option="option" autoresize />
  <div v-else class="flex h-[220px] items-center justify-center rounded-lg bg-surface-hover text-sm text-[#9E9E9A]">暂无数据</div>
</template>
