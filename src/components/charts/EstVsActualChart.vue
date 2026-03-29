<script setup lang="ts">
import { computed } from 'vue';

import type { EstimationComparison } from '../../types/domain';
import type { EstimationAccuracyTone } from './estVsActualModel';
import {
  ACCURATE_MINUTES_THRESHOLD,
  ACCURATE_PERCENT_THRESHOLD,
  buildEstimationAccuracyModel,
} from './estVsActualModel';

const props = defineProps<{
  data: EstimationComparison[];
}>();

const model = computed(() => buildEstimationAccuracyModel(props.data, { limit: props.data.length }));

function deltaToneClass(tone: EstimationAccuracyTone): string {
  if (tone === 'over') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  if (tone === 'under') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  return 'border-slate-200 bg-slate-100 text-slate-600';
}
</script>

<template>
  <section class="flex h-[320px] min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 lg:h-[260px]">
    <div class="border-b border-slate-200 bg-white px-4 py-3">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>
          平均偏差
          <strong class="ml-1 font-semibold text-slate-800">{{ model.summary.averageDeltaMinutes }}m</strong>
          <span class="ml-1">{{ model.summary.averageDeviationPercentage }}%</span>
        </span>
        <span>
          估准
          <strong class="ml-1 font-semibold text-slate-800">{{ model.summary.accurateCount }}/{{ model.summary.totalCount }}</strong>
          <span class="ml-1">{{ ACCURATE_MINUTES_THRESHOLD }} 分钟 / {{ ACCURATE_PERCENT_THRESHOLD }}% 内</span>
        </span>
        <span class="min-w-0 md:max-w-[18rem]">
          最大偏差
          <strong class="ml-1 font-semibold text-slate-800">{{ model.summary.largestDeltaLabel }}</strong>
          <span class="ml-1 inline-block max-w-full truncate align-bottom" :title="model.summary.largestDeltaTaskTitle">
            {{ model.summary.largestDeltaTaskTitle }}
          </span>
        </span>
      </div>
    </div>

    <div class="grid grid-cols-[minmax(0,1fr)_minmax(120px,1.2fr)_auto] items-center gap-3 border-b border-slate-200 px-4 py-2 text-[11px] text-slate-500">
      <div>任务</div>
      <div class="flex items-center gap-3">
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2 w-2 rounded-full bg-sky-300"></span>
          预估
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-3.5 w-[2px] rounded-full bg-slate-700"></span>
          实际
        </span>
        <span>标尺 {{ model.summary.scaleMaxMinutes }}m</span>
      </div>
      <div class="text-right">偏差</div>
    </div>

    <div class="min-h-0 overflow-y-auto">
      <article
        v-for="row in model.rows"
        :key="`${row.taskId}-${row.completedAt}`"
        class="grid grid-cols-[minmax(0,1fr)_minmax(120px,1.2fr)_auto] items-center gap-3 border-b border-slate-200/80 px-4 py-3 last:border-b-0"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-slate-800" :title="row.taskTitle">{{ row.taskTitle }}</p>
          <p class="mt-1 text-[11px] text-slate-500">
            {{ row.completedLabel }} · 预 {{ row.estimatedMinutes }}m · 实 {{ row.actualMinutes }}m
          </p>
        </div>

        <div class="relative h-2.5 overflow-visible rounded-full bg-slate-200">
          <div
            class="absolute inset-y-0 left-0 rounded-full bg-sky-300"
            :style="{ width: `${row.estimatedWidthPercent}%` }"
          ></div>
          <div
            class="absolute top-1/2 h-4 w-[2px] rounded-full bg-slate-700"
            :style="{ left: `${row.actualPositionPercent}%`, transform: 'translate(-50%, -50%)' }"
          ></div>
        </div>

        <div class="justify-self-end">
          <span
            class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
            :class="deltaToneClass(row.tone)"
          >
            {{ row.deltaLabel }}
          </span>
        </div>
      </article>
    </div>
  </section>
</template>
