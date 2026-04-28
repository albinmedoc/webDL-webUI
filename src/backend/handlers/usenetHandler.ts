import type { Socket } from 'socket.io';

import { usenetConfig } from '../config/usenetConfig.js';
import type { UsenetJob } from '../db/schema.js';
import {
  cancelJob,
  enqueueJob,
  getJob,
  listJobs,
  retryJob,
  subscribe,
  type JobObserver,
} from '../services/usenetService.js';
import type {
  UsenetJobSummary,
  UsenetUploadCancel,
  UsenetUploadRetry,
  UsenetUploadStart,
} from '../types/socket.js';
import { logger } from '../utils/logger.js';

function toSummary(job: UsenetJob): UsenetJobSummary {
  return {
    id: job.id,
    downloadId: job.downloadId,
    mediaPath: job.mediaPath,
    mediaSizeBytes: job.mediaSizeBytes,
    state: job.state,
    failureState: job.failureState,
    progress: job.progress,
    nzbPath: job.nzbPath,
    error: job.error,
    indexerResponse: job.indexerResponse,
    category: job.category,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export class UsenetHandler {
  private socket: Socket;
  private unsubscribe: (() => void) | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    this.subscribeToService();
  }

  private subscribeToService(): void {
    const observer: JobObserver = (jobId, event, payload) => {
      switch (event) {
        case 'state': {
          const job = getJob(jobId);
          this.socket.emit('usenet-state-changed', {
            jobId,
            state: payload as string,
            failureState: job?.failureState ?? null,
            error: job?.error ?? null,
          });
          if (payload === 'done') {
            this.socket.emit('usenet-completed', {
              jobId,
              job: job ? toSummary(job) : null,
            });
          }
          break;
        }
        case 'progress':
          this.socket.emit('usenet-progress', { jobId, progress: payload as number });
          break;
        case 'log':
          this.socket.emit('usenet-log', { jobId, line: payload as string });
          break;
      }
    };
    this.unsubscribe = subscribe(observer);
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private requireEnabled(): boolean {
    if (usenetConfig.enabled) return true;
    this.socket.emit('usenet-error', { error: 'Usenet feature is disabled' });
    return false;
  }

  async handleStartUpload(data: UsenetUploadStart): Promise<void> {
    if (!this.requireEnabled()) return;

    if (!data?.mediaPath) {
      this.socket.emit('usenet-error', { error: 'mediaPath is required' });
      return;
    }

    try {
      const job = await enqueueJob({
        mediaPath: data.mediaPath,
        downloadId: data.downloadId ?? null,
        category: data.category ?? null,
      });
      this.socket.emit('usenet-enqueued', { job: toSummary(job) });
    } catch (err) {
      const error = (err as Error).message;
      logger.warn('enqueueJob failed', { error });
      this.socket.emit('usenet-error', { error });
    }
  }

  handleCancelUpload(data: UsenetUploadCancel): void {
    if (!data?.jobId) {
      this.socket.emit('usenet-error', { error: 'jobId is required' });
      return;
    }
    const result = cancelJob(data.jobId);
    if (!result.cancelled) {
      this.socket.emit('usenet-error', {
        jobId: data.jobId,
        error: result.reason ?? 'cancel failed',
      });
    }
  }

  handleRetryUpload(data: UsenetUploadRetry): void {
    if (!this.requireEnabled()) return;
    if (!data?.jobId) {
      this.socket.emit('usenet-error', { error: 'jobId is required' });
      return;
    }
    const result = retryJob(data.jobId);
    if (!result.retried) {
      this.socket.emit('usenet-error', {
        jobId: data.jobId,
        error: result.reason ?? 'retry failed',
      });
    }
  }

  handleSyncUploads(): void {
    const jobs = listJobs(200).map(toSummary);
    this.socket.emit('usenet-sync', { jobs });
  }
}
