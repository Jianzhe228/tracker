export type ToneKind = 'start' | 'complete' | 'breakEnd' | 'taskDone';

const TONE_FREQUENCY: Record<ToneKind, number> = {
  start: 880,
  complete: 660,
  breakEnd: 520,
  taskDone: 660,
};

export function playTone(kind: ToneKind): void {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = TONE_FREQUENCY[kind];
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    if (kind === 'taskDone') {
      // Short rising two-note blip — completion should feel rewarding
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.12);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.start(now);
    osc.stop(now + 0.3);
    osc.onended = () => ctx.close();
  } catch (error) {
    console.warn('[sound] failed to play tone', error);
  }
}
