export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function apiRequest<T>(path: `/api/${string}`, options: { method?: 'GET' | 'POST' | 'PATCH'; body?: object } = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(result.error || 'Permintaan gagal.', response.status);
  return result;
}
