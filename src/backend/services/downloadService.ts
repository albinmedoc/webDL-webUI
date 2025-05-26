import { spawn, ChildProcess } from 'child_process';
import { SvtplayDlStatus } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface DownloadProcess {
  process: ChildProcess;
  command: string;
  url: string;
}

class DownloadService {
  private activeDownloads: Map<string, ChildProcess> = new Map();

  // Function to sanitize command for logging (hide sensitive data)
  sanitizeCommandForLogging(command: string, args: string[]): string {
    const sanitizedArgs = args.map((arg, index) => {
      // If previous arg was --token or -p (password), hide this arg
      if (index > 0 && (args[index - 1] === '--token' || args[index - 1] === '-p')) {
        return '***HIDDEN***';
      }
      return arg;
    });
    return `${command} ${sanitizedArgs.join(' ')}`;
  }

  // Validate URL to prevent command injection
  validateUrl(url: string): boolean {
    const urlRegex = /^https?:\/\/[^\s]+$/;
    return urlRegex.test(url);
  }

  // Start a download process
  startDownload(url: string, args: string[], downloadId: string): DownloadProcess {
    if (!url) {
      throw new Error('URL is required');
    }

    if (!this.validateUrl(url)) {
      throw new Error('Invalid URL format');
    }

    const command = 'svtplay-dl';
    const commandArgs = [...args, url];

    logger.debug(`Executing: ${this.sanitizeCommandForLogging(command, commandArgs)}`);

    const process = spawn(command, commandArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Store the process for potential cancellation
    this.activeDownloads.set(downloadId, process);

    return {
      process,
      command: this.sanitizeCommandForLogging(command, commandArgs),
      url
    };
  }

  // Cancel a download
  cancelDownload(downloadId: string): boolean {
    const process = this.activeDownloads.get(downloadId);
    
    if (process) {
      process.kill('SIGTERM');
      this.activeDownloads.delete(downloadId);
      return true;
    }
    return false;
  }

  // Check if download is active
  isDownloadActive(downloadId: string): boolean {
    return this.activeDownloads.has(downloadId);
  }

  // Get all active download IDs
  getActiveDownloadIds(): string[] {
    return Array.from(this.activeDownloads.keys());
  }

  // Remove download from active list
  removeDownload(downloadId: string): void {
    this.activeDownloads.delete(downloadId);
  }

  // Check svtplay-dl availability
  checkSvtplayDlAvailability(): Promise<SvtplayDlStatus> {
    return new Promise((resolve) => {
      const process = spawn('svtplay-dl', ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      process.on('close', (code: number | null) => {
        if (code === 0) {
          resolve({
            available: true,
            version: output.trim()
          });
        } else {
          resolve({
            available: false,
            error: errorOutput || 'svtplay-dl not found'
          });
        }
      });

      process.on('error', (error: Error) => {
        resolve({
          available: false,
          error: `svtplay-dl not found: ${error.message}`
        });
      });
    });
  }
}

export default new DownloadService();
