{
  function skipAd() {
    const player = document.querySelector('#movie_player, #player');
    if (!player?.classList.contains('ad-showing') && !player?.classList.contains('ad-interrupting')) return;
    const skip = player.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skip && !skip.disabled && skip.getClientRects().length) skip.click();
  }
  setInterval(skipAd, 250);
  document.addEventListener('yt-navigate-finish', skipAd);
}
