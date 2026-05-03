import path from 'path';

/**
 * Lowercase, dedupe, and ensure each entry has a leading dot. Accepts user
 * input like ['mkv', '.MP4', '  .mkv '] and returns ['.mkv', '.mp4'].
 */
export function normalizeExtensions(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ext of raw) {
    if (typeof ext !== 'string') continue;
    let trimmed = ext.trim().toLowerCase();
    if (!trimmed) continue;
    if (!trimmed.startsWith('.')) trimmed = '.' + trimmed;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * `allowed` should already be normalized (or will be normalized here for
 * safety). Empty allowlist disables filtering — every file passes.
 */
export function isAllowedExtension(filePath: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return false;
  return allowed.includes(ext);
}
