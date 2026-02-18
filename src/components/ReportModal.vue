<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
    close: [];
}>();

const dateRange = ref("7d");
</script>

<template>
    <Teleport to="body">
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            @click.self="emit('close')"
        >
            <div
                class="flex h-[85vh] w-[90vw] max-w-6xl flex-col rounded-xl bg-white shadow-2xl"
            >
                <!-- Header -->
                <div
                    class="flex items-center justify-between border-b border-slate-200 px-6 py-4"
                >
                    <h2 class="text-lg font-semibold text-slate-800">
                        统计报告
                    </h2>
                    <button
                        class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        @click="emit('close')"
                    >
                        <svg
                            class="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>

                <!-- Content -->
                <div class="flex-1 overflow-auto p-6">
                    <!-- Stats Cards -->
                    <div class="mb-6 grid grid-cols-6 gap-4">
                        <div class="rounded-lg border border-slate-200 p-4">
                            <div
                                class="flex items-center gap-2 text-sm text-slate-500"
                            >
                                <span class="h-2 w-0.5 rounded bg-red-400" />
                                总专注时间
                            </div>
                            <div class="mt-2">
                                <span
                                    class="text-2xl font-semibold text-red-500"
                                    >0</span
                                >
                                <span class="text-sm text-slate-400">分钟</span>
                            </div>
                        </div>
                        <div class="rounded-lg border border-slate-200 p-4">
                            <div
                                class="flex items-center gap-2 text-sm text-slate-500"
                            >
                                <span class="h-2 w-0.5 rounded bg-red-400" />
                                本周专注
                            </div>
                            <div class="mt-2">
                                <span
                                    class="text-2xl font-semibold text-red-500"
                                    >0</span
                                >
                                <span class="text-sm text-slate-400">分钟</span>
                            </div>
                        </div>
                        <div class="rounded-lg border border-slate-200 p-4">
                            <div
                                class="flex items-center gap-2 text-sm text-slate-500"
                            >
                                <span class="h-2 w-0.5 rounded bg-red-400" />
                                今日专注
                            </div>
                            <div class="mt-2">
                                <span
                                    class="text-2xl font-semibold text-red-500"
                                    >0</span
                                >
                                <span class="text-sm text-slate-400">分钟</span>
                            </div>
                        </div>
                        <div class="rounded-lg border border-slate-200 p-4">
                            <div
                                class="flex items-center gap-2 text-sm text-slate-500"
                            >
                                <span class="h-2 w-0.5 rounded bg-blue-400" />
                                总完成任务
                            </div>
                            <div class="mt-2">
                                <span
                                    class="text-2xl font-semibold text-blue-500"
                                    >0</span
                                >
                            </div>
                        </div>
                        <div class="rounded-lg border border-slate-200 p-4">
                            <div
                                class="flex items-center gap-2 text-sm text-slate-500"
                            >
                                <span class="h-2 w-0.5 rounded bg-blue-400" />
                                本周完成
                            </div>
                            <div class="mt-2">
                                <span
                                    class="text-2xl font-semibold text-blue-500"
                                    >0</span
                                >
                            </div>
                        </div>
                        <div class="rounded-lg border border-slate-200 p-4">
                            <div
                                class="flex items-center gap-2 text-sm text-slate-500"
                            >
                                <span class="h-2 w-0.5 rounded bg-blue-400" />
                                今日完成
                            </div>
                            <div class="mt-2">
                                <span
                                    class="text-2xl font-semibold text-blue-500"
                                    >0</span
                                >
                            </div>
                        </div>
                    </div>

                    <!-- Charts Grid -->
                    <div class="grid grid-cols-3 gap-6">
                        <!-- Pomodoro Records -->
                        <div
                            class="col-span-2 rounded-lg border border-slate-200 p-4"
                        >
                            <h3 class="mb-4 font-medium text-slate-800">
                                番茄记录
                            </h3>
                            <div
                                class="flex h-48 items-center justify-center rounded bg-slate-50"
                            >
                                <div class="text-center text-slate-400">
                                    <svg
                                        class="mx-auto h-12 w-12"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                                        />
                                    </svg>
                                    <p class="mt-2 text-sm">暂无数据</p>
                                </div>
                            </div>
                        </div>

                        <!-- Focus Time -->
                        <div class="rounded-lg border border-slate-200 p-4">
                            <div class="mb-4 flex items-center justify-between">
                                <h3 class="font-medium text-slate-800">
                                    专注时间
                                </h3>
                                <button
                                    class="text-xs text-slate-500 hover:text-slate-700"
                                >
                                    显示任务
                                </button>
                            </div>
                            <p class="mb-3 text-xs text-slate-500">
                                总专注时间: 0分钟
                            </p>
                            <div
                                class="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1"
                            >
                                <button
                                    class="flex-1 rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm"
                                >
                                    日
                                </button>
                                <button
                                    class="flex-1 rounded-md px-2 py-1 text-xs text-slate-600"
                                >
                                    周
                                </button>
                                <button
                                    class="flex-1 rounded-md px-2 py-1 text-xs text-slate-600"
                                >
                                    月
                                </button>
                                <button
                                    class="flex-1 rounded-md px-2 py-1 text-xs text-slate-600"
                                >
                                    年
                                </button>
                            </div>
                            <div
                                class="flex h-32 items-center justify-center rounded bg-slate-50"
                            >
                                <p class="text-sm text-slate-400">暂无数据</p>
                            </div>
                        </div>

                        <!-- Project Time Distribution -->
                        <div
                            class="col-span-2 rounded-lg border border-slate-200 p-4"
                        >
                            <div class="mb-4 flex items-center justify-between">
                                <h3 class="font-medium text-slate-800">
                                    清单时间分布
                                </h3>
                                <div class="flex items-center gap-2">
                                    <div
                                        class="flex gap-1 rounded-lg bg-slate-100 p-1"
                                    >
                                        <button
                                            class="rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm"
                                        >
                                            日
                                        </button>
                                        <button
                                            class="rounded-md px-2 py-1 text-xs text-slate-600"
                                        >
                                            周
                                        </button>
                                        <button
                                            class="rounded-md px-2 py-1 text-xs text-slate-600"
                                        >
                                            月
                                        </button>
                                        <button
                                            class="rounded-md px-2 py-1 text-xs text-slate-600"
                                        >
                                            年
                                        </button>
                                    </div>
                                    <div class="flex items-center gap-1">
                                        <button
                                            class="rounded p-1 text-slate-400 hover:bg-slate-100"
                                        >
                                            <svg
                                                class="h-4 w-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M15 19l-7-7 7-7"
                                                />
                                            </svg>
                                        </button>
                                        <span class="text-sm text-slate-600"
                                            >今天</span
                                        >
                                        <button
                                            class="rounded p-1 text-slate-400 hover:bg-slate-100"
                                        >
                                            <svg
                                                class="h-4 w-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M9 5l7 7-7 7"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div
                                class="flex h-40 items-center justify-center rounded bg-slate-50"
                            >
                                <div class="text-center text-slate-400">
                                    <svg
                                        class="mx-auto h-10 w-10"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                        />
                                    </svg>
                                    <p class="mt-2 text-sm">暂无数据</p>
                                </div>
                            </div>
                        </div>

                        <!-- Focus Time Goal -->
                        <div class="rounded-lg border border-slate-200 p-4">
                            <div class="mb-2 flex items-center justify-between">
                                <h3 class="font-medium text-slate-800">
                                    专注目标
                                </h3>
                                <span class="text-xs text-slate-500"
                                    >目标: 3小时</span
                                >
                            </div>
                            <p class="mb-3 text-xs text-slate-500">
                                专注天数: 0天，完成目标天数: 0天，目标完成率: 0%
                            </p>

                            <!-- Mini Calendar -->
                            <div class="rounded-lg border border-slate-100 p-3">
                                <div
                                    class="mb-2 flex items-center justify-between"
                                >
                                    <button
                                        class="text-slate-400 hover:text-slate-600"
                                    >
                                        <svg
                                            class="h-4 w-4"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M15 19l-7-7 7-7"
                                            />
                                        </svg>
                                    </button>
                                    <span class="text-sm font-medium"
                                        >Feb 2026</span
                                    >
                                    <button
                                        class="text-slate-400 hover:text-slate-600"
                                    >
                                        <svg
                                            class="h-4 w-4"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M9 5l7 7-7 7"
                                            />
                                        </svg>
                                    </button>
                                </div>
                                <div
                                    class="grid grid-cols-7 gap-1 text-center text-xs"
                                >
                                    <span class="text-slate-400">Mo</span>
                                    <span class="text-slate-400">Tu</span>
                                    <span class="text-slate-400">We</span>
                                    <span class="text-slate-400">Th</span>
                                    <span class="text-slate-400">Fr</span>
                                    <span class="text-slate-400">Sa</span>
                                    <span class="text-red-400">Su</span>
                                    <span
                                        v-for="d in 28"
                                        :key="d"
                                        class="rounded py-1"
                                        :class="
                                            d === 8
                                                ? 'bg-red-500 text-white'
                                                : 'text-slate-600 hover:bg-slate-100'
                                        "
                                    >
                                        {{ d }}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
