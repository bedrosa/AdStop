import { cleanPlayerResponse, isPlayerUrl, isAdblockFailure, rewritePlayerRequest } from '../shared/youtube.js';

{
  const parse = JSON.parse;
  const requestUrl = Object.getOwnPropertyDescriptor(Request.prototype, 'url').get;
  let recovery = { videoId: '', attempts: 0, lastAttempt: 0, mode: '' };
  let frames;
  let playbackError;

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
    if (recovery.mode) {
      try {
        const input = args[0];
        const url = input instanceof Request ? Reflect.apply(requestUrl, input, []) : String(input);
        if (isPlayerUrl(url, location.href)) {
          const body = args[1]?.body ?? (input instanceof Request && input.method === 'POST' ? await input.clone().text() : undefined);
          const rewritten = rewritePlayerRequest(body, recovery.videoId, recovery.mode);
          if (rewritten !== body) args = [input, { ...args[1], body: rewritten }];
        }
      } catch {}
    }
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
  const postRequest = new WeakSet();
  const observed = new WeakSet();
  XMLHttpRequest.prototype.open = new Proxy(open, { apply(target, receiver, args) {
    if (isPlayerUrl(String(args[1]), location.href)) playerRequest.add(receiver);
    else playerRequest.delete(receiver);
    if (String(args[0]).toUpperCase() === 'POST') postRequest.add(receiver);
    else postRequest.delete(receiver);
    if (!observed.has(receiver)) {
      observed.add(receiver);
      receiver.addEventListener('readystatechange', () => {
        if (playerRequest.has(receiver) && receiver.readyState === 4 && receiver.responseType === 'json' && isPlayerUrl(receiver.responseURL, location.href)) cleanPlayerResponse(receiver.response);
      });
    }
    return Reflect.apply(target, receiver, args);
  } });
  XMLHttpRequest.prototype.send = new Proxy(XMLHttpRequest.prototype.send, { apply(target, receiver, args) {
    if (playerRequest.has(receiver) && postRequest.has(receiver) && recovery.mode) args = [rewritePlayerRequest(args[0], recovery.videoId, recovery.mode)];
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

  const dismissed = new WeakSet();
  function reloadPlayer(player, video, response, blocked) {
    const videoId = response?.videoDetails?.videoId;
    if (!videoId || typeof player.loadVideoById !== 'function' || recovery.attempts >= 2 || Date.now() - recovery.lastAttempt < 15000) return;
    recovery.videoId = videoId;
    recovery.attempts++;
    recovery.lastAttempt = Date.now();
    if (blocked) recovery.mode = recovery.attempts === 1 ? 'channel' : 'lactmilli';
    const position = video?.currentTime || response.playerConfig?.playbackStartConfig?.startSeconds || 0;
    player.loadVideoById(videoId, position);
    frames = undefined;
    playbackError = undefined;
  }

  function skipAd() {
    const player = document.querySelector('#movie_player, #player');
    const video = player?.querySelector('video');
    const response = player?.getPlayerResponse?.();
    if (response?.videoDetails?.videoId && response.videoDetails.videoId !== recovery.videoId) {
      recovery = { videoId: response.videoDetails.videoId, attempts: 0, lastAttempt: 0, mode: '' };
      frames = undefined;
      playbackError = undefined;
    }
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
    if (isAdblockFailure(response)) {
      reloadPlayer(player, video, response, true);
      return;
    }
    if (showing && video) {
      const skip = player.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
      if (skip && !skip.disabled && skip.getClientRects().length) skip.click();
      frames = undefined;
      playbackError = undefined;
      return;
    }
    if (!video || video.paused || video.ended || video.seeking || document.visibilityState !== 'visible') {
      frames = undefined;
      playbackError = undefined;
      return;
    }
    const error = player.querySelector('.ytp-error-content-wrap, #error-screen');
    if (player.classList.contains('ytp-error') && error?.getClientRects().length && /se ha producido un error|an error (?:has )?occurred/i.test(error.textContent)) {
      if (!playbackError || playbackError.video !== video || playbackError.source !== video.currentSrc || video.currentTime < playbackError.time) {
        playbackError = { video, source: video.currentSrc, time: video.currentTime, since: Date.now() };
      } else if (Date.now() - playbackError.since >= 2000 && video.currentTime - playbackError.time >= 1) {
        reloadPlayer(player, video, response, false);
        return;
      }
    } else playbackError = undefined;
    if (!video.videoWidth) {
      frames = undefined;
      return;
    }
    const quality = video.getVideoPlaybackQuality?.();
    if (!quality) return;
    const rendered = quality.totalVideoFrames - quality.droppedVideoFrames;
    if (!frames || frames.video !== video || frames.source !== video.currentSrc || rendered !== frames.rendered || video.currentTime < frames.time) {
      frames = { video, source: video.currentSrc, rendered, time: video.currentTime, since: Date.now() };
    } else if (Date.now() - frames.since >= 6000 && video.currentTime - frames.time >= 3) {
      reloadPlayer(player, video, response, false);
    }
  }
  setInterval(skipAd, 250);
  document.addEventListener('yt-navigate-finish', skipAd);
}
