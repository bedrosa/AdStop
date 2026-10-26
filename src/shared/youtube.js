const adKeys = new Set(['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adBreakParams']);

export function cleanPlayerResponse(value) {
  if (!value || typeof value !== 'object') return value;
  for (const key of adKeys) {
    if (Object.hasOwn(value, key)) Reflect.deleteProperty(value, key);
  }
  const messages = value.auxiliaryUi?.messageRenderers;
  if (messages && typeof messages === 'object') Reflect.deleteProperty(messages, 'bkaEnforcementMessageViewModel');
  if (value.playerResponse) cleanPlayerResponse(value.playerResponse);
  if (value.response) cleanPlayerResponse(value.response);
  if (Array.isArray(value)) value.forEach(cleanPlayerResponse);
  return value;
}

export function isPlayerUrl(input, base) {
  try {
    const url = new URL(typeof input === 'string' ? input : input.url, base);
    return /^https?:$/.test(url.protocol) && /(^|\.)youtube\.com$/.test(url.hostname) && /^\/youtubei\/v1\/(player|get_watch|next)\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isAdblockFailure(response) {
  if (response?.playabilityStatus?.status !== 'UNPLAYABLE') return false;
  const screen = response.playabilityStatus.errorScreen;
  if (screen?.playerErrorMessageRenderer?.playerCaptchaViewModel) return false;
  const runs = screen?.playerErrorMessageRenderer?.subreason?.runs || screen?.playerInterstitialRenderer?.content?.interstitialViewModel?.description?.commandRuns;
  return Array.isArray(runs) && runs.some(run => {
    const metadata = run.navigationEndpoint?.commandMetadata?.webCommandMetadata || run.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata;
    return metadata?.webPageType === 'WEB_PAGE_TYPE_UNKNOWN' && metadata.url === 'https://support.google.com/youtube/answer/3037019';
  });
}

export function rewritePlayerRequest(text, videoId, mode) {
  if (!mode || typeof text !== 'string') return text;
  try {
    const body = JSON.parse(text);
    const client = body.context?.client;
    if (body.videoId !== videoId || client?.clientName !== 'WEB' || !body.playbackContext?.contentPlaybackContext) return text;
    const playback = body.playbackContext.contentPlaybackContext;
    if (mode === 'channel') client.clientScreen = 'CHANNEL';
    else if (mode === 'lactmilli') {
      body.params = '8AUB';
    } else return text;
    playback.lactMilliseconds = String(Date.now());
    if (typeof playback.referer === 'string') playback.referer = playback.referer.replace(/(?:#reloadxhr)?$/, '#reloadxhr');
    return JSON.stringify(body);
  } catch {
    return text;
  }
}
