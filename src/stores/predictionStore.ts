import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { listen } from '@tauri-apps/api/event';

import { useTaskStore } from './taskStore';
import {
  refreshPredictions as refreshPredictionsCmd,
  getPendingPredictions,
  updatePredictionStatus,
  getPredictionStats,
  getRecentNotificationKeys,
  type PendingPredictionRow,
  type PredictionStats,
} from '../services/commands/prediction';
import { sendNotification } from '../services/notification';
import { toDateKey } from '../utils/date';

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

interface PredictionUpdatePayload {
  createdCount: number;
  triggeredAt: string;
}

export const usePredictionStore = defineStore('prediction', () => {
  const pendingPredictions = ref<PendingPredictionRow[]>([]);
  const stats = ref<PredictionStats | null>(null);
  const isAnalyzing = ref(false);
  const lastAnalysisAt = ref<string | null>(null);

  const hasPending = computed(() => pendingPredictions.value.length > 0);
  const pendingCount = computed(() => pendingPredictions.value.length);

  async function loadPendingPredictions(): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      pendingPredictions.value = await getPendingPredictions(10);
    } catch (err) {
      console.error('[predictionStore] Failed to load pending predictions:', err);
    }
  }

  async function loadStats(): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      stats.value = await getPredictionStats();
    } catch (err) {
      console.error('[predictionStore] Failed to load stats:', err);
    }
  }

  async function notifyFreshPredictions(createdCount: number): Promise<void> {
    if (createdCount <= 0) return;

    // 24h cooldown: don't re-notify the same title_key if we already pushed
    // it to the OS in the last day. Prevents "every hourly tick re-pings me
    // about 写周报".
    const recentKeys = new Set(await getRecentNotificationKeys(24).catch(() => [] as string[]));

    const freshPredictions = pendingPredictions.value
      .filter((prediction) => prediction.status === 'pending')
      .slice(0, createdCount);

    for (const prediction of freshPredictions) {
      const key = prediction.titleKey;
      if (key && recentKeys.has(key)) {
        await updatePredictionStatus(prediction.id, 'notified');
        prediction.status = 'notified';
        prediction.notifiedAt = new Date().toISOString();
        continue;
      }

      sendNotification({
        type: 'prediction',
        title: '今日任务预测',
        body: `${prediction.title}${prediction.reason ? `（${prediction.reason}）` : ''}`,
        payload: JSON.stringify({ predictionId: prediction.id }),
      });

      await updatePredictionStatus(prediction.id, 'notified');
      prediction.status = 'notified';
      prediction.notifiedAt = new Date().toISOString();
      if (key) recentKeys.add(key);
    }
  }

  async function refreshPredictions(force = false): Promise<void> {
    if (!isTauriRuntime() || isAnalyzing.value) return;

    isAnalyzing.value = true;
    try {
      const result = await refreshPredictionsCmd(force);
      await loadPendingPredictions();
      await loadStats();
      await notifyFreshPredictions(result.createdCount);
      lastAnalysisAt.value = new Date().toISOString();
    } catch (err) {
      console.error('[predictionStore] Refresh failed:', err);
    } finally {
      isAnalyzing.value = false;
    }
  }

  async function acceptPrediction(id: number): Promise<void> {
    if (!isTauriRuntime()) return;

    const prediction = pendingPredictions.value.find((item) => item.id === id);
    if (!prediction) return;

    const taskStore = useTaskStore();
    await taskStore.addTask(prediction.title, {
      projectId: prediction.projectId,
      dueAt: prediction.predictedForDate ?? toDateKey(new Date()),
    });

    await updatePredictionStatus(id, 'accepted');
    pendingPredictions.value = pendingPredictions.value.filter((item) => item.id !== id);
    await loadStats();
  }

  async function rejectPrediction(id: number): Promise<void> {
    if (!isTauriRuntime()) return;

    await updatePredictionStatus(id, 'rejected');
    pendingPredictions.value = pendingPredictions.value.filter((item) => item.id !== id);
    await loadStats();
  }

  async function dismissPrediction(id: number): Promise<void> {
    if (!isTauriRuntime()) return;

    await updatePredictionStatus(id, 'notified');
    const prediction = pendingPredictions.value.find((item) => item.id === id);
    if (prediction) {
      prediction.status = 'notified';
      prediction.notifiedAt = new Date().toISOString();
    }
  }

  let unlistenFn: (() => void) | null = null;

  async function startListening(): Promise<void> {
    if (!isTauriRuntime() || unlistenFn) return;

    try {
      unlistenFn = await listen<PredictionUpdatePayload>('prediction:updated', (event) => {
        console.log('[predictionStore] Received update event:', event.payload);
        void loadPendingPredictions()
          .then(() => notifyFreshPredictions(event.payload.createdCount))
          .then(() => loadStats())
          .then(() => {
            lastAnalysisAt.value = new Date().toISOString();
          });
      });
      console.log('[predictionStore] Listening for prediction updates');
    } catch (err) {
      console.error('[predictionStore] Failed to start listening:', err);
    }
  }

  function stopListening(): void {
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  }

  void loadPendingPredictions();
  void loadStats();
  void startListening();

  return {
    pendingPredictions,
    stats,
    isAnalyzing,
    lastAnalysisAt,
    hasPending,
    pendingCount,
    loadPendingPredictions,
    loadStats,
    refreshPredictions,
    acceptPrediction,
    rejectPrediction,
    dismissPrediction,
    startListening,
    stopListening,
  };
});
