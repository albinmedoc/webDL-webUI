export interface ServerConfig {
  port: number;
  cors: {
    origin: string;
    methods: string[];
  };
}

export interface ProcessSpawnOptions {
  stdio: ('pipe' | 'inherit' | 'ignore')[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ProgressData {
  progress: number | null;
  eta: string | null;
  status: 'downloading' | 'completed' | 'error';
}
