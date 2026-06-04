// Wires the top-bar controls and keyboard shortcuts to the player.
export function wireControls({ player, els, onVoiceChange }) {
  const setPlayIcon = () => {
    els.playBtn.innerHTML = player.isPaused() ? "&#9658;" : "&#10073;&#10073;";
  };

  const togglePlay = () => {
    if (player.isPaused()) player.play();
    else player.pause();
    setPlayIcon();
  };

  els.playBtn.addEventListener("click", togglePlay);
  els.nextBtn.addEventListener("click", () => { player.next(); setPlayIcon(); });
  els.prevBtn.addEventListener("click", () => { player.prev(); setPlayIcon(); });
  els.stopBtn.addEventListener("click", () => { player.stop(); setPlayIcon(); });

  els.speedInput.addEventListener("input", () => {
    const rate = parseFloat(els.speedInput.value);
    player.setSpeed(rate);
    els.speedLabel.textContent = `${rate.toFixed(1)}×`;
  });

  els.voiceSelect.addEventListener("change", () => onVoiceChange(els.voiceSelect.value));

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.code === "ArrowRight") { e.preventDefault(); player.next(); setPlayIcon(); }
    else if (e.code === "ArrowLeft") { e.preventDefault(); player.prev(); setPlayIcon(); }
  });

  player.audio.addEventListener("play", setPlayIcon);
  player.audio.addEventListener("pause", setPlayIcon);

  return { setPlayIcon };
}
