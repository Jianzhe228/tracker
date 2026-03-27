import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from './settingsStore';
import { useTaskStore } from './taskStore';
import {
  getPredictionAnalysisContext,
  savePredictions,
  getPendingPredictions,
  updatePredictionStatus,
  getPredictionStats,
  type PendingPredictionRow,
  type PredictionStats,
  type PredictionSavePayload,
} from '../services/commands/prediction';
import { enqueue } from '../services/ai/queue';
import { sendNotification } from '../services/notification';

const isTauri = '__TAURI_INTERNALS__' in window;

interface PredictionTriggerPayload {
  historyCount: number;
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
    if (!isTauri) return;
    try {
      pendingPredictions.value = await getPendingPredictions(10);
    } catch (err) {
      console.error('[predictionStore] Failed to load pending predictions:', err);
    }
  }

  async function loadStats(): Promise<void> {
    if (!isTauri) return;
    try {
      stats.value = await getPredictionStats();
    } catch (err) {
      console.error('[predictionStore] Failed to load stats:', err);
    }
  }

  async function triggerAnalysis(): Promise<void> {
    if (isAnalyzing.value) return;

    const settingsStore = useSettingsStore();
    if (!settingsStore.ai.endpoint || !settingsStore.ai.apiKey) {
      console.log('[predictionStore] AI not configured, skipping analysis');
      return;
    }

    isAnalyzing.value = true;
    try {
      const context = await getPredictionAnalysisContext(14);

      // If not enough history, skip AI call
      if (context.count < 7) {
        console.log('[predictionStore] Not enough history for analysis:', context.count);
        return;
      }

      // Enqueue AI analysis job
      const job = await enqueue('task_history_analyzer', {
        currentTime: context.currentTime,
        dayOfWeek: context.dayOfWeek,
        days: context.days,
        count: context.count,
        taskList: context.taskList,
        recentProjects: context.recentProjects,
      });

      if (job && job.status === 'completed' && job.rawResponse) {
        const response = JSON.parse(job.rawResponse);
        const predictions: PredictionSavePayload[] = (response.predictions || []).map(
          (p: { title: string; reason?: string }) => ({
            title: p.title,
            reason: p.reason || null,
          })
        );

        if (predictions.length > 0) {
          const ids = await savePredictions(predictions, job.rawResponse, job.id);
          console.log('[predictionStore] Saved', ids.length, 'predictions');

          // Notify user about new predictions
          for (const pred of predictions.slice(0, 3)) {
            sendNotification({
              type: 'prediction',
              title: '📅 今日任务预测',
              body: `${pred.title}${pred.reason ? `（${pred.reason}）` : ''}`,
              payload: JSON.stringify({ predictionId: ids[predictions.indexOf(pred)] }),
            });
          }

          await loadPendingPredictions();
          await loadStats();
        }
      }

      lastAnalysisAt.value = new Date().toISOString();
    } catch (err) {
      console.error('[predictionStore] Analysis failed:', err);
    } finally {
      isAnalyzing.value = false;
    }
  }

  async function acceptPrediction(id: number): Promise<void> {
    if (!isTauri) return;

    const prediction = pendingPredictions.value.find((p) => p.id === id);
    if (!prediction) return;

    // Create the task
    const taskStore = useTaskStore();
    await taskStore.addTask(prediction.title);

    // Update prediction status
    await updatePredictionStatus(id, 'accepted');
    pendingPredictions.value = pendingPredictions.value.filter((p) => p.id !== id);
    await loadStats();
  }

  async function rejectPrediction(id: number): Promise<void> {
    if (!isTauri) return;

    await updatePredictionStatus(id, 'rejected');
    pendingPredictions.value = pendingPredictions.value.filter((p) => p.id !== id);
    await loadStats();
  }

  async function dismissPrediction(id: number): Promise<void> {
    if (!isTauri) return;

    await updatePredictionStatus(id, 'notified');
    await loadPendingPredictions();
  }

  let unlistenFn: (() => void) | null = null;

  async function startListening(): Promise<void> {
    if (!isTauri) return;
    if (unlistenFn) return;

    try {
      unlistenFn = await listen<PredictionTriggerPayload>(
        'prediction:trigger-analysis',
        (event) => {
          console.log('[predictionStore] Received trigger event:', event.payload);
          void triggerAnalysis();
        }
      );
      console.log('[predictionStore] Listening for prediction triggers');
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

  // Initial load
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
    triggerAnalysis,
    acceptPrediction,
    rejectPrediction,
    dismissPrediction,
    startListening,
    stopListening,
  };
});
