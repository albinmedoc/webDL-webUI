import { ProgressData, ValidationResult, DownloadRequest } from '../types/index.js';

export class ProgressParser {
  static parseProgress(chunk: string): ProgressData {
    let progress: number | null = null;
    let eta: string | null = null;
    let status: 'downloading' | 'completed' | 'error' = 'downloading';
    
    // Check for completion messages
    if (chunk.includes('Download completed successfully')) {
      progress = 100;
      status = 'completed';
    }
    
    // svtplay-dl progress format: [current/total][progress_bar] ETA: time
    const progressMatch = chunk.match(/\[(\d+)\/(\d+)\]/);
    if (progressMatch) {
      const current = parseInt(progressMatch[1], 10);
      const total = parseInt(progressMatch[2], 10);
      progress = total > 0 ? Math.round((current / total) * 100 * 100) / 100 : 0;
      
      // If current equals total, we're at 100%
      if (current === total) {
        progress = 100;
      }
    }
    
    // Extract ETA
    const etaMatch = chunk.match(/ETA:\s*(\d+:\d+:\d+|\d+:\d+)/);
    if (etaMatch) {
      eta = etaMatch[1];
      // If ETA is 0:00:00, we're essentially done with download
      if (eta === '0:00:00') {
        progress = 100;
      }
    }

    return { progress, eta, status };
  }

  static isProgressData(chunk: string): boolean {
    return /\[\d+\/\d+\]/.test(chunk) || chunk.includes('ETA:');
  }

  static isSignificantChunk(chunk: string, progress: number | null): boolean {
    return progress !== null || 
           chunk.includes('INFO:') || 
           chunk.includes('ERROR:') || 
           chunk.includes('[');
  }
}

export class ValidationUtils {
  static validateDownloadRequest(data: Partial<DownloadRequest>): ValidationResult {
    const { url, downloadId } = data;

    if (!url) {
      return { valid: false, error: 'URL is required' };
    }

    if (!downloadId) {
      return { valid: false, error: 'Download ID is required' };
    }

    return { valid: true };
  }
}
