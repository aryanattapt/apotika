export const api = async (path, { csrf, ...options } = {}) => {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json')
  if (csrf && !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) headers.set('x-csrf-token', csrf)
  const response = await fetch(`/api/v1${path}`, { credentials: 'include', ...options, headers })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(result.error?.message || 'Permintaan belum dapat diproses.'), { code: result.error?.code, status: response.status })
  return result.data
}
