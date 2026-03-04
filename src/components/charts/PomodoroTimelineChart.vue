<script setup lang="ts">
import { computed } from 'vue';
import { VChart } from '../../composables/useECharts';
import type { FocusSession } from '../../types/domain';

const props = defineProps<{
  sessions: FocusSession[];
}>();

const option = computed(() => {
  const items = props.sessions.filter(s => s.type === 'focus');
  if (items.length === 0) {
    return {
      title: {
        text: '暂无数据',
        left: 'center',
        top: 'center',
        textStyle: { color: '#94a3b8', fontSize: 14, fontWeight: 'normal' },
      },
    };
  }

  const data = items.map(s => {
    const start = new Date(s.startTime);
    const startHour = start.getHours() + start.getMinutes() / 60;
    const durationHours = s.durationSeconds / 3600;
    return {
      value: [0, startHour, startHour + durationHours, s.durationSeconds],
      itemStyle: {
        color: s.status === 'completed' ? '#3b82f6' : '#94a3b8',
      },
    };
  });

  return {
    tooltip: {
      formatter: (params: { value: number[] }) => {
        const [, startH, , dur] = params.value;
        const h = Math.floor(startH);
        const m = Math.round((startH - h) * 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}<br/>专注 ${Math.round(dur / 60)} 分钟`;
      },
    },
    grid: {
      top: 10,
      right: 16,
      bottom: 30,
      left: 48,
    },
    xAxis: { show: false, min: -0.5, max: 0.5 },
    yAxis: {
      type: 'value',
      min: 0,
      max: 24,
      inverse: true,
      interval: 2,
      axisLabel: {
        formatter: (val: number) => `${String(val).padStart(2, '0')}:00`,
        fontSize: 11,
        color: '#94a3b8',
      },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    series: [{
      type: 'custom',
      renderItem: (_params: unknown, api: {
        value: (idx: number) => number;
        coord: (val: number[]) => number[];
        size: (val: number[]) => number[];
      }) => {
        const startVal = api.value(1);
        const endVal = api.value(2);
        const start = api.coord([0, startVal]);
        const end = api.coord([0, endVal]);
        const width = api.size([1, 0])[0] * 0.6;
        return {
          type: 'rect',
          shape: {
            x: start[0] - width / 2,
            y: start[1],
            width,
            height: Math.max(4, end[1] - start[1]),
            r: 4,
          },
          style: api.value(3) > 0 ? { fill: '#3b82f6', opacity: 0.8 } : { fill: '#94a3b8' },
        };
      },
      data,
      encode: { x: 0, y: [1, 2] },
    }],
  };
});
</script>

<template>
  <VChart :option="option" autoresize style="height: 400px; width: 100%" />
</template>
