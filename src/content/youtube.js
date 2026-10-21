import { cleanPlayerResponse, isPlayerUrl } from '../shared/youtube.js';

{
  const parse = JSON.parse;

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
  window.fetch = new Proxy(nativeFetch, { async apply(target, receiver, args) {
    const response = await Reflect.apply(target, receiver, args);
    if (!response.ok || !isPlayerUrl(response.url, location.href)) return response;
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
  } });

  const open = XMLHttpRequest.prototype.open;
  const responseText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
  const responseValue = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  const playerRequest = new WeakSet();
  const observed = new WeakSet();
  XMLHttpRequest.prototype.open = new Proxy(open, { apply(target, receiver, args) {
    if (isPlayerUrl(String(args[1]), location.href)) playerRequest.add(receiver);
    else playerRequest.delete(receiver);
    if (!observed.has(receiver)) {
      observed.add(receiver);
      receiver.addEventListener('readystatechange', () => {
        if (playerRequest.has(receiver) && receiver.readyState === 4 && receiver.responseType === 'json' && isPlayerUrl(receiver.responseURL, location.href)) cleanPlayerResponse(receiver.response);
      });
    }
    return Reflect.apply(target, receiver, args);
  } });
  for (const [key, original] of [['responseText', responseText], ['response', responseValue]]) {
    Object.defineProperty(XMLHttpRequest.prototype, key, {
      configurable: original.configurable,
      enumerable: original.enumerable,
      get: new Proxy(original.get, { apply(target, receiver, args) {
        const value = Reflect.apply(target, receiver, args);
        if (!playerRequest.has(receiver) || receiver.readyState !== 4 || !isPlayerUrl(receiver.responseURL, location.href)) return value;
        if (key === 'response' && receiver.responseType === 'json') return cleanPlayerResponse(value);
        if (typeof value !== 'string') return value;
        try {
          return JSON.stringify(cleanPlayerResponse(parse(value)));
        } catch {
          return value;
        }
      } })
    });
  }

  let previous;
  const dismissed = new WeakSet();
  function skipAd() {
    const player = document.querySelector('#movie_player, #player');
    const video = player?.querySelector('video');
    const message = document.querySelector('ytd-enforcement-message-view-model');
    if (message && !dismissed.has(message) && /ad.?block|bloqueador(?:es)? de anuncios/i.test(message.textContent)) {
      const close = message.querySelector('#dismiss-button button') || message.querySelector('button#dismiss-button, yt-icon-button#dismiss-button');
      if (close && !close.disabled) {
        dismissed.add(message);
        close.click();
        if (video?.paused) {
          if (typeof player.playVideo === 'function') player.playVideo();
          else video.play().catch(() => {});
        }
      }
    }
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
