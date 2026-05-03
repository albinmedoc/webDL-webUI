export interface DownloadRequest {
  url: string;
  args: string[];
  autoPostUsenet?: boolean;
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

export interface DownloadFile {
  path: string;
  size: number;
}

export interface DownloadFiles {
  downloadId: string;
  outputDir: string;
  files: DownloadFile[];
}

export interface DownloadCompleted {
  downloadId: string;
  success: boolean;
  output: string;
  command?: string;
  error?: string;
  outputDir?: string;
  files?: DownloadFile[];
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

export interface UsenetUploadStart {
  mediaPath: string;
  downloadId?: string | null;
  category?: string | null;
  quality?: string | null;
  applyNaming?: boolean;
}

export interface UsenetUploadCancel {
  jobId: string;
}

export interface UsenetUploadRetry {
  jobId: string;
}

export interface UsenetJobSummary {
  id: string;
  downloadId: string | null;
  mediaPath: string;
  mediaSizeBytes: number;
  state: string;
  failureState: string | null;
  progress: number;
  nzbPath: string | null;
  error: string | null;
  indexerResponse: string | null;
  category: string | null;
  logs: string[];
  createdAt: number;
  updatedAt: number;
}

export interface UsenetStateChanged {
  jobId: string;
  state: string;
  failureState?: string | null;
  error?: string | null;
}

export interface UsenetProgress {
  jobId: string;
  progress: number;
}

export interface UsenetLog {
  jobId: string;
  line: string;
}

export interface UsenetSyncResponse {
  jobs: UsenetJobSummary[];
}

export interface UsenetEnqueued {
  job: UsenetJobSummary;
}

export interface UsenetError {
  jobId?: string;
  error: string;
}
