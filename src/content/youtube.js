import { cleanPlayerResponse, isPlayerUrl } from '../shared/youtube.js';

if (!window.__adstopYoutube) {
  Object.defineProperty(window, '__adstopYoutube', { value: true });
  const parse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const result = Reflect.apply(parse, this, arguments);
    return typeof text === 'string' && /"(?:adPlacements|adSlots|playerAds)"/.test(text) ? cleanPlayerResponse(result) : result;
  };

  let initial = cleanPlayerResponse(window.ytInitialPlayerResponse);
  const descriptor = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get: () => initial,
      set: value => { initial = cleanPlayerResponse(value); }
    });
  }

  const nativeFetch = window.fetch;
  window.fetch = async function (input) {
    const response = await Reflect.apply(nativeFetch, this, arguments);
    if (!response.ok || !isPlayerUrl(input, location.href)) return response;
    try {
      const data = cleanPlayerResponse(await response.clone().json());
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      const cleaned = new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
      for (const key of ['url', 'redirected', 'type']) Object.defineProperty(cleaned, key, { value: response[key] });
      return cleaned;
    } catch {
      return response;
    }
  };

  const open = XMLHttpRequest.prototype.open;
  const responseText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
  const responseValue = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  const playerRequest = new WeakSet();
  const observed = new WeakSet();
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isPlayerUrl(String(url), location.href)) playerRequest.add(this);
    else playerRequest.delete(this);
    if (!observed.has(this)) {
      observed.add(this);
      this.addEventListener('readystatechange', () => {
        if (playerRequest.has(this) && this.readyState === 4 && this.responseType === 'json') cleanPlayerResponse(this.response);
      });
    }
    return Reflect.apply(open, this, arguments);
  };
  for (const [key, original] of [['responseText', responseText], ['response', responseValue]]) {
    Object.defineProperty(XMLHttpRequest.prototype, key, {
      configurable: original.configurable,
      enumerable: original.enumerable,
      get() {
        const value = original.get.call(this);
        if (!playerRequest.has(this) || this.readyState !== 4) return value;
        if (key === 'response' && this.responseType === 'json') return cleanPlayerResponse(value);
        if (typeof value !== 'string') return value;
        try {
          return JSON.stringify(cleanPlayerResponse(parse(value)));
        } catch {
          return value;
        }
      }
    });
  }

  let previous;
  function skipAd() {
    const player = document.querySelector('#movie_player, #player');
    const video = player?.querySelector('video');
    const showing = player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting');
    if (showing && video) {
      const skip = player.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
      if (skip && !skip.disabled) skip.click();
      if (!previous || previous.video !== video) {
        previous = { video, muted: video.muted, rate: video.playbackRate };
      }
      video.muted = true;
      if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 180) video.playbackRate = 16;
    } else if (previous) {
      previous.video.muted = previous.muted;
      previous.video.playbackRate = previous.rate;
      previous = undefined;
    }
  }
  setInterval(skipAd, 250);
  document.addEventListener('yt-navigate-finish', skipAd);
}
