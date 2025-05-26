export interface DownloadRequest {
  url: string;
  args: string[];
  downloadId: string;
}

export interface DownloadProgress {
  downloadId: string;
  chunk: string;
  output?: string;
  progress?: number | null;
  eta?: string | null;
  status?: 'downloading' | 'completed' | 'error';
  error?: boolean;
}

export interface DownloadStarted {
  downloadId: string;
  command: string;
  url: string;
}

export interface DownloadCompleted {
  downloadId: string;
  success: boolean;
  output: string;
  command?: string;
  error?: string;
}

export interface DownloadError {
  downloadId: string;
  error: string;
}

export interface DownloadCancelled {
  downloadId: string;
}

export interface DownloadSync {
  downloadId: string;
  status: string;
  progress: number | null;
}

export interface DownloadNotFound {
  downloadId: string;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp: string;
}

export interface SvtplayDlStatus {
  available: boolean;
  version?: string;
  error?: string;
}
