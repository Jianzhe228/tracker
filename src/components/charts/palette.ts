/**
 * 图表统一调色板。集中管理 ECharts 用到的颜色，确保设计系统变更时只改一处。
 * 语义映射与 tailwind.config.js 的 primary/success/warning/danger 一致。
 */
export const chartPalette = {
  primary: '#2563eb',
  primaryMid: '#3b82f6',
  primaryLight: '#60a5fa',
  success: '#10b981',
  successAlt: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  violet: '#8b5cf6',
  /** 轴线、网格、次要文字 */
  axisLabel: '#94a3b8',
  axisLine: '#e2e8f0',
  splitLine: '#f1f5f9',
  textMuted: '#64748b',
  textStrong: '#1e293b',
  bgSoft: '#f8fafc',
  slate400: '#94a3b8',
  slate600: '#475569',
} as const;

/** 多系列图表默认配色顺序。 */
export const chartSeriesPalette = [
  chartPalette.primary,
  chartPalette.success,
  chartPalette.warning,
  chartPalette.violet,
  chartPalette.danger,
  '#06b6d4',
] as const;
