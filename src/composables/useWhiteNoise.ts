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

const PREF_KEY = 'whiteNoisePref';
const VOL_KEY = 'whiteNoiseVolume';

// Module-level singleton — persists across modal open/close while app is running
const activeSoundId = ref<string | null>(null);
// Last sound explicitly chosen by the user (null = user chose off); persisted to localStorage
const lastUserSoundId = ref<string | null>(localStorage.getItem(PREF_KEY));
const volume = ref<number>(parseFloat(localStorage.getItem(VOL_KEY) ?? '0.6'));
let audioEl: HTMLAudioElement | null = null;

function stopAudio(): void {
  if (!audioEl) return;
  audioEl.pause();
  audioEl.src = '';
  audioEl = null;
}

function startAudio(id: string): void {
  const sound = SOUNDS.find(s => s.id === id);
  if (!sound) return;
  audioEl = new Audio(sound.file);
  audioEl.loop = true;
  audioEl.volume = volume.value;
  audioEl.play().catch(() => {});
}

// Called by user action (chip click) — updates preference
function selectSound(id: string | null): void {
  // Clicking the active sound toggles it off
  const target = id === activeSoundId.value ? null : id;
  lastUserSoundId.value = target;
  if (target !== null) {
    localStorage.setItem(PREF_KEY, target);
  } else {
    localStorage.removeItem(PREF_KEY);
  }
  stopAudio();
  activeSoundId.value = target;
  if (target !== null) startAudio(target);
}

// Called by timer events — stops audio but preserves user preference
function stopForTimer(): void {
  stopAudio();
  activeSoundId.value = null;
}

// Called when timer starts/resumes — restores last user preference
function resumeLastSound(): void {
  if (!lastUserSoundId.value) return;
  activeSoundId.value = lastUserSoundId.value;
  startAudio(lastUserSoundId.value);
}

function setVolume(v: number): void {
  volume.value = v;
  localStorage.setItem(VOL_KEY, String(v));
  if (audioEl) audioEl.volume = v;
}

export function useWhiteNoise() {
  return { activeSoundId, volume, SOUNDS, selectSound, setVolume, stopForTimer, resumeLastSound };
}
