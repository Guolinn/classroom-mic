const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export function validEndpoint(value) {
  if (typeof value !== 'string' || value.length > 100) return false;
  try {
    const u = new URL(value), parts = u.hostname.split('.').map(Number);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || parts.some(n => n < 0 || n > 255)) return false;
    const local = parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
    return local && u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/' && u.origin === value;
  } catch { return false; }
}
export function validLocalAudio(value) {
  return !!value && typeof value === 'object' && validEndpoint(value.url) && tokenPattern.test(value.hash) && tokenPattern.test(value.ticket);
}
export function parseReceiverCode(code) {
  if (typeof code !== 'string' || code.length > 1024 || !code.startsWith('mt1.')) throw new Error('Paste the pairing code from the receiver.');
  let config;
  try { config = JSON.parse(atob(code.trim().slice(4).replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw new Error('Invalid receiver code.'); }
  if (config?.v !== 1 || !validEndpoint(config.url) || !tokenPattern.test(config.hash) || !tokenPattern.test(config.key)) throw new Error('Invalid receiver code.');
  return { v: 1, url: config.url, hash: config.hash, key: config.key };
}
