const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
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
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function onUnauthorized() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("catlium:unauthorized"));
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    const csrf = readCookie("csrf_token");
    refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: csrf ? { "x-csrf-token": csrf } : {},
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function parseMessage(message: unknown): string {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map(String).join(", ");
  if (message && typeof message === "object" && "message" in message) {
    return parseMessage((message as { message: unknown }).message);
  }
  return "An unexpected error occurred";
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  json?: boolean;
}

export async function api<T>(
  path: string,
  { method = "GET", body, signal, json = true }: ApiOptions = {},
): Promise<T> {
  const doRequest = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const instituteId = getActiveInstituteId();
    if (instituteId) headers["x-institute-id"] = instituteId;

    const csrf = readCookie("csrf_token");
    if (method.toUpperCase() !== "GET" && csrf) headers["x-csrf-token"] = csrf;

    return fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  };

  let response = await doRequest();
  if (response.status === 401 && path !== "/auth/refresh") {
    if (await refreshSession()) {
      response = await doRequest();
    }
  }

  if (response.status === 401) {
    onUnauthorized();
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
  return (
    job.status === "completed" || job.status === "failed" || job.status === "cancelled"
  );
}

/** Download a file endpoint (export) as a blob and trigger a browser download. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const doRequest = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    const instituteId = getActiveInstituteId();
    if (instituteId) headers["x-institute-id"] = instituteId;
    return fetch(`${API_URL}${path}`, { headers, credentials: "include" });
  };
  let response = await doRequest();
  if (response.status === 401) {
    if (await refreshSession()) {
      response = await doRequest();
    } else {
      onUnauthorized();
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, `Download failed with status ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function waitForJob<T extends { job: { status: string } }>(
  fetchJob: () => Promise<T>,
  { timeoutMs = 5 * 60 * 1000, intervalMs = 3000 }: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fetchJob();
  while (!jobDone(last.job)) {
    if (Date.now() > deadline) {
      throw new ApiError(408, "Job timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await fetchJob();
  }
  if (last.job.status === "failed") {
    const error = (last as { job: { error?: { message?: string } } }).job.error;
    throw new ApiError(422, error?.message ?? "Job failed");
  }
  if (last.job.status === "cancelled") {
    throw new ApiError(409, "Job cancelled");
  }
  return last;
}