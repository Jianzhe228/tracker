<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { DailyTotal } from '../../types/domain';
import { formatAxisMinutes, formatMinutes } from '../../utils/date';

const props = defineProps<{
  data: DailyTotal[];
  compact?: boolean;
  /** Number of trailing days to show by default in the zoom window. */
  defaultWindow?: number;
}>();

const total = computed(() => props.data.length);

// Default window: most recent N days. Falls back to all if data is shorter.
const defaultWindow = computed(() => Math.min(props.defaultWindow ?? 14, total.value));

const startPercent = computed(() => {
  if (total.value <= 1) return 0;
  return Math.max(0, ((total.value - defaultWindow.value) / (total.value - 1)) * 100);
});

const option = computed(() => {
  const minutesData = props.data.map(d => Math.round(d.totalSeconds / 60));
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: '#C4CBF5' } },
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0];
        return `${p.name}<br/>${formatMinutes(Math.round(p.value))}`;
      },
    },
    grid: {
      top: props.compact ? 14 : 30,
      right: 16,
      bottom: props.compact ? 38 : 48,
      left: 48,
    },
    xAxis: {
      type: 'category',
      data: props.data.map(d => d.date.slice(5)),
      axisLabel: { fontSize: 11, color: '#94a3b8', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      nameTextStyle: { color: '#94a3b8', fontSize: 11 },
      axisLabel: {
        fontSize: 11,
        color: '#94a3b8',
        formatter: (value: number) => formatAxisMinutes(value),
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
        // Recompute Y on zoom so spikes don't compress detail at low values.
        filterMode: 'filter',
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        start: startPercent.value,
        end: 100,
        height: 14,
        bottom: 6,
        borderColor: 'transparent',
        backgroundColor: '#F5F6FA',
        fillerColor: 'rgba(92,105,216,0.18)',
        handleSize: 14,
        handleStyle: {
          color: '#FFFFFF',
          borderColor: '#5C69D8',
          borderWidth: 1.5,
          shadowBlur: 0,
        },
        moveHandleSize: 4,
        moveHandleStyle: { color: '#5C69D8', opacity: 0.6 },
        textStyle: { color: '#9E9E9A', fontSize: 10 },
        labelFormatter: (_: number, str: string) => str,
        showDetail: false,
        brushSelect: false,
      },
    ],
    series: [{
      type: 'line',
      data: minutesData,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      sampling: 'lttb',
      lineStyle: { width: 2, color: '#5C69D8' },
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
  <VChart
    :option="option"
    autoresize
    :style="{ height: compact ? '210px' : '300px', width: '100%' }"
  />
</template>
