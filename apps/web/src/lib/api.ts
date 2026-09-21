// Same-origin by default: nginx routes /api/* -> api:3000, so the browser can
// call the API relative to the page origin (no bake-time URL, no CORS). Set
// NEXT_PUBLIC_API_URL only to point the client at a DIFFERENT origin on purpose.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let activeInstituteId: string | null = null;

export function setActiveInstituteId(instituteId: string | null) {
  activeInstituteId = instituteId;
}

export function getActiveInstituteId(): string | null {
  return activeInstituteId;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function onUnauthorized() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('catlium:unauthorized'));
  }
}

function onForbidden() {
  // Authenticated-but-not-authorized (403), distinct from a dead session
  // (401). The workspace layout renders an access-denied view; no logout, no
  // refresh loop — mutating requests keep their normal error toast instead.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('catlium:forbidden'));
  }
}

let refreshPromise: Promise<RefreshOutcome> | null = null;

type RefreshOutcome = 'ok' | 'unauthorized' | 'unavailable';

/**
 * Rotate the session. Outcome is tri-state on purpose:
 *  - 'ok':           a new access+refresh pair was issued, the caller may retry.
 *  - 'unauthorized': the server positively rejected the refresh (401/403) —
 *                    the session is genuinely dead and a logout is correct.
 *  - 'unavailable':  the refresh could not be answered reliably (network error,
 *                    5xx, 429). The session may still be perfectly valid, so
 *                    callers MUST NOT treat this as a logout.
 */
async function refreshSession(): Promise<RefreshOutcome> {
  const csrf = readCookie('csrf_token');
  const outcome =
    refreshPromise ??
    (refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'x-csrf-token': csrf } : {},
    })
      .then((r): RefreshOutcome => {
        if (r.ok) return 'ok';
        if (r.status === 401 || r.status === 403) return 'unauthorized';
        return 'unavailable';
      })
      .catch((): RefreshOutcome => 'unavailable')
      .finally(() => {
        refreshPromise = null;
      }));
  return outcome;
}

function parseMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join(', ');
  if (message && typeof message === 'object' && 'message' in message) {
    return parseMessage((message as { message: unknown }).message);
  }
  return 'An unexpected error occurred';
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  json?: boolean;
  headers?: Record<string, string>;
}

export async function api<T>(
  path: string,
  { method = 'GET', body, signal, json = true, headers: customHeaders }: ApiOptions = {},
): Promise<T> {
  const doRequest = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...customHeaders };
    if (body !== undefined && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const instituteId = getActiveInstituteId();
    if (instituteId) headers['x-institute-id'] = instituteId;

    const csrf = readCookie('csrf_token');
    if (method.toUpperCase() !== 'GET' && csrf) headers['x-csrf-token'] = csrf;

    return fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  };

  let response = await doRequest();
  if (response.status === 401 && path !== '/auth/refresh') {
    const outcome = await refreshSession();
    if (outcome === 'ok') {
      response = await doRequest();
      // Rotated yet the retry is STILL 401 — the request itself is denied.
      if (response.status === 401) onUnauthorized();
    } else if (outcome === 'unauthorized') {
      // The refresh endpoint positively rejected the session — genuine logout.
      onUnauthorized();
    } else {
      // Refresh was not answered reliably (network / 5xx / 429). The session
      // may be fine — a transient infrastructure blip must never log the user
      // out, so surface it as a retryable error instead of a 401.
      throw new ApiError(503, 'Session check temporarily unavailable — please retry');
    }
  } else if (response.status === 401) {
    // Direct /auth/refresh 401 = the session is genuinely gone.
    onUnauthorized();
  }

  // Authenticated-but-not-authorized page-load denial (401 flow already
  // handled above, so this also fires when a refreshed session is still
  // denied). Surface the Forbidden view; never a logout or refresh loop.
  if (response.status === 403 && method.toUpperCase() === 'GET') {
    onForbidden();
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: unknown };
      if (payload?.message) message = parseMessage(payload.message);
    } catch {
      // keep fallback message
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204 || !json) return undefined as T;
  return (await response.json()) as T;
}

export function jobDone(job: { status: string }): boolean {
  return job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
}

// 2MB parts keep every chunk request at ~35s over the Cloudflare Tunnel's
// measured ~55KB/s upload path — well under the 100s origin budget that used
// to 524 whole-file uploads.
const CHUNK_BYTES = 2 * 1024 * 1024;

export interface ChunkProgress {
  sentBytes: number;
  totalBytes: number;
}

/** Upload a file in 2MB multipart parts to the same endpoint, one request per
 *  part (x-upload-id/x-chunk-index/x-chunk-total). The server stores each part
 *  and reassembles them on the final request, answering with the normal final
 *  response. Callers pass the file's non-file form fields for EVERY part so the
 *  assembled request carries identical metadata.
 *
 *  Each part goes out over XMLHttpRequest so real byte-level progress of the
 *  WHOLE file can be reported (fetch exposes no upload progress). Pass a
 *  signal to abort an in-flight upload. */
export async function uploadFileWithChunks<T>(
  path: string,
  file: File,
  fields: Record<string, string>,
  onProgress?: (progress: ChunkProgress) => void,
  signal?: AbortSignal,
): Promise<T> {
  const uploadId = crypto.randomUUID();
  const total = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  let sentBase = 0;
  for (let index = 1; index <= total; index++) {
    const start = (index - 1) * CHUNK_BYTES;
    const part = file.slice(start, Math.min(start + CHUNK_BYTES, file.size));
    const body = await uploadChunk(
      path,
      uploadId,
      index,
      total,
      part,
      file.name,
      file.type,
      fields,
      signal,
      (loaded) =>
        onProgress?.({
          sentBytes: sentBase + Math.min(loaded, part.size),
          totalBytes: file.size,
        }),
    );
    sentBase += part.size;
    onProgress?.({ sentBytes: sentBase, totalBytes: file.size });
    if (body && 'chunk' in body && body.chunk && body.chunk.index < total) continue;
    return body as T;
  }
  // Unreachable: total >= 1 always yields a final (index === total) response.
  throw new Error('Chunked upload ended without a final response');
}

interface ChunkBody {
  chunk?: { index: number; total: number };
  [key: string]: unknown;
}

async function uploadChunk(
  path: string,
  uploadId: string,
  index: number,
  total: number,
  part: Blob,
  name: string,
  type: string,
  fields: Record<string, string>,
  signal: AbortSignal | undefined,
  onChunkProgress: (loaded: number) => void,
): Promise<ChunkBody> {
  const attempt = async (): Promise<{ status: number; json: ChunkBody | null }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}${path}`);
      xhr.withCredentials = true;
      const instituteId = getActiveInstituteId();
      if (instituteId) xhr.setRequestHeader('x-institute-id', instituteId);
      const csrf = readCookie('csrf_token');
      if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
      xhr.setRequestHeader('x-upload-id', uploadId);
      xhr.setRequestHeader('x-chunk-index', String(index));
      xhr.setRequestHeader('x-chunk-total', String(total));
      xhr.responseType = 'json';

      const abort = () => xhr.abort();
      signal?.addEventListener('abort', abort, { once: true });

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onChunkProgress(e.loaded);
      };
      xhr.onload = () => {
        signal?.removeEventListener('abort', abort);
        resolve({ status: xhr.status, json: (xhr.response as ChunkBody | null) ?? null });
      };
      xhr.onerror = () => {
        signal?.removeEventListener('abort', abort);
        reject(new ApiError(0, 'Network error during upload'));
      };
      xhr.onabort = () => {
        signal?.removeEventListener('abort', abort);
        reject(new DOMException('The upload was aborted', 'AbortError'));
      };

      const form = new FormData();
      form.append('file', new File([part], name, { type }));
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      xhr.send(form);
    });
  };

  let result = await attempt();
  if (result.status === 401) {
    const outcome = await refreshSession();
    if (outcome === 'ok') {
      result = await attempt();
    } else if (outcome === 'unauthorized') {
      onUnauthorized();
      throw new ApiError(401, 'Unauthorized');
    } else {
      throw new ApiError(503, 'Session check temporarily unavailable — please retry');
    }
  }
  if (result.status !== 200 && result.status !== 201) {
    const payload = result.json as { message?: unknown } | null;
    throw new ApiError(
      result.status,
      payload?.message ? parseMessage(payload.message) : `Request failed with status ${result.status}`,
    );
  }
  return result.json ?? {};
}

/** Best-effort, non-destructive client-side size reduction before upload.
 *  Re-encodes lossy raster formats (JPEG/WebP) as JPEG at the SAME
 *  dimensions — never resizes, so OCR-relevant detail is preserved. Returns a
 *  smaller temp copy or null (not optimizable / no meaningful reduction); the
 *  original file is never modified. Skips PNG/GIF (transparency / animation). */
export async function optimizeImageFile(file: File): Promise<File | null> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/webp') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8),
    );
    if (!blob || blob.size >= file.size) return null;
    return new File([blob], file.name, { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

/** Download a file endpoint (export) as a blob and trigger a browser download. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const doRequest = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    const instituteId = getActiveInstituteId();
    if (instituteId) headers['x-institute-id'] = instituteId;
    return fetch(`${API_URL}${path}`, { headers, credentials: 'include' });
  };
  let response = await doRequest();
  if (response.status === 401) {
    const outcome = await refreshSession();
    if (outcome === 'ok') {
      response = await doRequest();
    } else if (outcome === 'unauthorized') {
      onUnauthorized();
    } else {
      throw new ApiError(503, 'Session check temporarily unavailable — please retry');
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, `Download failed with status ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function waitForJob<T extends { job: { status: string } }>(

  fetchJob: () => Promise<T>,
  {
    timeoutMs = 5 * 60 * 1000,
    intervalMs = 3000,
  }: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fetchJob();
  while (!jobDone(last.job)) {
    if (Date.now() > deadline) {
      throw new ApiError(408, 'Job timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await fetchJob();
  }
  if (last.job.status === 'failed') {
    const error = (last as { job: { error?: { message?: string } } }).job.error;
    throw new ApiError(422, error?.message ?? 'Job failed');
  }
  if (last.job.status === 'cancelled') {
    throw new ApiError(409, 'Job cancelled');
  }
  return last;
}

/** Poll a question-bank generation batch until it has no active jobs left.
 * Returns the final batch so callers can inspect failures. */
export async function waitForBankBatch(
  batchId: string,
  { timeoutMs = 5 * 60 * 1000, intervalMs = 3000 } = {},
): Promise<{ active: number; failed: number }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const batch = await api<{ active: number; failed: number }>(
      `/questions/bank/batches/${batchId}`,
    );
    if (batch.active === 0) return batch;
    if (Date.now() > deadline) throw new ApiError(408, 'Question generation timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

