export function resolveV3ApiBase(value?: string): string {
  if (value === undefined || value === '') return '/api/v3'
  if (value === '/api/v3') return value
  if (value.trim() !== value || /[\\%\s]/.test(value)) throw new TypeError('Invalid V3 API base')
  const u = new URL(value)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  if (
    u.protocol !== 'https:' ||
    (!loopback && u.hostname !== 'api.pixelweave.xyz') ||
    (!loopback && u.port !== '') ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !/^https:\/\/[^/]+\/api\/v3\/?$/.test(value) ||
    !['/api/v3', '/api/v3/'].includes(u.pathname)
  )
    throw new TypeError('Unapproved V3 API base')
  return u.origin + '/api/v3'
}
