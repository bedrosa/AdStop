const adKeys = new Set(['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adBreakParams']);

export function cleanPlayerResponse(value) {
  if (!value || typeof value !== 'object') return value;
  for (const key of adKeys) {
    if (Object.hasOwn(value, key)) Reflect.deleteProperty(value, key);
  }
  if (value.playerResponse) cleanPlayerResponse(value.playerResponse);
  if (value.response) cleanPlayerResponse(value.response);
  if (Array.isArray(value)) value.forEach(cleanPlayerResponse);
  return value;
}

export function isPlayerUrl(input, base) {
  try {
    const url = new URL(typeof input === 'string' ? input : input.url, base);
    return /(^|\.)youtube\.com$/.test(url.hostname) && /^\/youtubei\/v1\/(player|next)(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}
