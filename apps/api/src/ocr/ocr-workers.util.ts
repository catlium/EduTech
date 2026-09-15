import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return `owr_${randomBytes(24).toString('base64url')}`;
}

export function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export type OcrWorkerStatus = 'processing' | 'idle' | 'offline' | 'disabled';

export function deriveStatus(
  enabled: boolean,
  currentChunkId: string | null,
  lastHeartbeatAt: Date | null,
  offlineMs: number,
): OcrWorkerStatus {
  const stale = (timestamp: Date | null): boolean => {
    if (!timestamp) return true;
    return new Date().getTime() - timestamp.getTime() > offlineMs;
  };
  if (!enabled) return 'disabled';
  if (currentChunkId) return 'processing';
  if (stale(lastHeartbeatAt)) return 'offline';
  return 'idle';
}
