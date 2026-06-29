import { ref } from 'vue';

export interface WhiteNoiseSound {
  id: string;
  label: string;
  file: string;
}

export const SOUNDS: WhiteNoiseSound[] = [
  { id: 'light-rain', label: '轻雨', file: '/sounds/light-rain.mp3' },
  { id: 'heavy-rain', label: '大雨', file: '/sounds/heavy-rain.mp3' },
  { id: 'campfire', label: '篝火', file: '/sounds/campfire.mp3' },
  { id: 'forest', label: '丛林', file: '/sounds/forest.mp3' },
  { id: 'ocean', label: '海浪', file: '/sounds/ocean-waves.mp3' },
  { id: 'cafe', label: '咖啡馆', file: '/sounds/cafe.mp3' },
  { id: 'birds', label: '鸟鸣', file: '/sounds/birds.mp3' },
  { id: 'river', label: '溪流', file: '/sounds/river.mp3' },
];

// Module-level singleton — persists across modal open/close while app is running
const activeSoundId = ref<string | null>(null);
const volume = ref(0.6);
let audioEl: HTMLAudioElement | null = null;

function stopAudio(): void {
  if (!audioEl) return;
  audioEl.pause();
  audioEl.src = '';
  audioEl = null;
}

function selectSound(id: string | null): void {
  // Clicking the active sound toggles it off
  if (id === activeSoundId.value) {
    activeSoundId.value = null;
    stopAudio();
    return;
  }
  stopAudio();
  activeSoundId.value = id;
  if (id === null) return;
  const sound = SOUNDS.find(s => s.id === id);
  if (!sound) return;
  audioEl = new Audio(sound.file);
  audioEl.loop = true;
  audioEl.volume = volume.value;
  audioEl.play().catch(() => {});
}

function setVolume(v: number): void {
  volume.value = v;
  if (audioEl) audioEl.volume = v;
}

export function useWhiteNoise() {
  return { activeSoundId, volume, SOUNDS, selectSound, setVolume };
}
