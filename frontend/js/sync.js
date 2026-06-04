// Distribute a sentence's audio duration across its words by character length,
// with extra dwell after punctuation. Pure and unit-tested.
export function wordSchedule(words, durationSec) {
  if (words.length === 0) return [];

  const weights = words.map((w) => {
    let weight = Math.max(w.replace(/[^\p{L}\p{N}]/gu, "").length, 1);
    if (/[,;:]$/.test(w)) weight += 2;
    if (/[.!?]["')\]]?$/.test(w)) weight += 4;
    return weight;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return weights.map((weight) => {
    const slot = { start: t, end: t + (weight / total) * durationSec };
    t = slot.end;
    return slot;
  });
}

// Drives sentence/word highlighting and auto-scroll against audio playback.
export class SyncController {
  constructor(audio, reader, { onProgress } = {}) {
    this.audio = audio;
    this.reader = reader;
    this.onProgress = onProgress || (() => {});
    this._schedule = [];
    this._words = [];
    this._activeWord = -1;
    this._rafId = null;
    this._tick = this._tick.bind(this);
    // Resume the highlight loop on any playback resume (button, keyboard,
    // end-of-sentence advance). _loop cancels the pending frame first, so this
    // never double-ticks.
    this.audio.addEventListener("play", () => {
      if (this._schedule.length) this._loop();
    });
  }

  beginSentence(segmentId, words) {
    this._clearWord();
    this._words = this.reader.wordElements(segmentId);
    this._schedule = wordSchedule(words, this.audio.duration || 0.0001);
    this._activeWord = -1;
    this.reader.markActiveSentence(segmentId);
    this._loop();
  }

  _loop() {
    cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(this._tick);
  }

  _tick() {
    const t = this.audio.currentTime;
    let idx = this._schedule.findIndex((s) => t >= s.start && t < s.end);
    if (idx === -1 && t >= (this._schedule.at(-1)?.end ?? 0)) {
      idx = this._schedule.length - 1;
    }
    if (idx !== -1 && idx !== this._activeWord) this._setActiveWord(idx);
    if (this.audio.duration) this.onProgress(this.audio.currentTime / this.audio.duration);
    if (!this.audio.paused && !this.audio.ended) this._loop();
  }

  _setActiveWord(idx) {
    this._clearWord();
    const el = this._words[idx];
    if (el) {
      el.classList.add("active");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    this._activeWord = idx;
  }

  _clearWord() {
    if (this._activeWord >= 0 && this._words[this._activeWord]) {
      this._words[this._activeWord].classList.remove("active");
    }
  }

  stop() {
    cancelAnimationFrame(this._rafId);
    this._clearWord();
  }
}
