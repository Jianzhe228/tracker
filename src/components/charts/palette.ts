/**
 * Chart palette — Calm Precision design system.
 * Mirrors tailwind.config.js semantic colors.
 */
export const chartPalette = {
  primary: '#4B55C4',
  primaryMid: '#5C69D8',
  primaryLight: '#7A86E3',
  success: '#2D9A64',
  successAlt: '#3EA97B',
  warning: '#C0860A',
  danger: '#C12838',
  violet: '#8282E8',
  axisLabel: '#9E9E9A',
  axisLine: '#ECECE8',
  splitLine: '#F5F5F2',
  textMuted: '#6F6F6B',
  textStrong: '#1C1C1A',
  bgSoft: '#FAFAF8',
  slate400: '#9E9E9A',
  slate600: '#6F6F6B',
} as const;

export const chartSeriesPalette = [
  chartPalette.primary,
  chartPalette.success,
  chartPalette.warning,
  chartPalette.violet,
  chartPalette.danger,
  '#06B6D4',
] as const;
