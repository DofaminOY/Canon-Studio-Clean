// Short-lived in-memory task state. One active upload/print at a time.
import { MAX_TASKS } from '../config.js';

export let currentTask = null;
export let pendingUpload = false;
export const recentTasks = [];
export function setCurrentTask(task) { currentTask = task; }
export function setPendingUpload(value) { pendingUpload = Boolean(value); }
export function releaseTask(task) { if (currentTask?.id === task.id) currentTask = null; }
export function keepTask(task) { recentTasks.unshift(task); recentTasks.length = Math.min(recentTasks.length, MAX_TASKS); }

export function publicTask(t) {
  if (!t) return null;
  return {
    id: t.id, status: t.status, message: t.message, warning: t.warning || null, type: t.type, totalPages: t.totalPages ?? null, pagesSelected: t.pagesSelected ?? null,
    printer: t.printer, fileName: t.fileName, windowsJobId: t.windowsJobId ?? null,
    ippJobId: t.ippJobId ?? null, started: t.started,
    canCancel: ['sending', 'spooling', 'submitted', 'cancel-requested'].includes(t.status),
  };
}

export function update(t, status, message) {
  t.status = status;
  t.message = message;
}

export function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Мониторим очередь Windows только для поиска нашего документа по уникальному имени.
// Не отменяем посторонние задания по одному лишь различию ID.
