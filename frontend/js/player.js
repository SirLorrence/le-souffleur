import { synthesizeUrl } from "./api.js";

const PREFETCH_AHEAD = 2;

export class Player {
  constructor(segments, { getVoice, onSentenceStart, onEnded, onBuffering } = {}) {
    this.segments = segments;
    this.getVoice = getVoice || (() => "af_heart");
    this.onSentenceStart = onSentenceStart || (() => {});
    this.onEnded = onEnded || (() => {});
    this.onBuffering = onBuffering || (() => {});

    this.audio = new Audio();
    this.audio.preload = "auto";
    this.index = 0;
    this.speed = 1.0;
    this._buffer = new Map(); // segmentId -> objectURL
    this._playing = false;

    this.audio.addEventListener("ended", () => this._advance());
  }

  setSpeed(rate) {
    this.speed = rate;
    this.audio.playbackRate = rate;
  }

  async _ensure(index) {
    if (index < 0 || index >= this.segments.length) return null;
    const seg = this.segments[index];
    if (this._buffer.has(seg.id)) return this._buffer.get(seg.id);
    try {
      const url = await synthesizeUrl(seg.text, this.getVoice());
      this._buffer.set(seg.id, url);
      return url;
    } catch (err) {
      console.warn("synthesis failed for segment", seg.id, err);
      return null;
    }
  }

  _prefetch() {
    for (let i = 1; i <= PREFETCH_AHEAD; i++) this._ensure(this.index + i);
  }

  _trim() {
    const keepFrom = this.segments[this.index].id - 1;
    for (const [id, url] of this._buffer) {
      if (id < keepFrom) {
        URL.revokeObjectURL(url);
        this._buffer.delete(id);
      }
    }
  }

  async playFrom(index) {
    if (index < 0 || index >= this.segments.length) return;
    this.index = index;
    this._playing = true;
    this.onBuffering(true);
    const url = await this._ensure(index);
    this.onBuffering(false);
    if (!url) { this._advance(); return; }          // skip a failed sentence
    if (!this._playing || this.index !== index) return; // superseded by a jump
    this.audio.src = url;
    this.audio.playbackRate = this.speed;
    await this.audio.play();
    const seg = this.segments[index];
    this.onSentenceStart(seg, seg.text.split(/\s+/).filter(Boolean));
    this._prefetch();
    this._trim();
  }

  _advance() {
    if (!this._playing) return;
    if (this.index + 1 >= this.segments.length) {
      this._playing = false;
      this.onEnded();
      return;
    }
    this.playFrom(this.index + 1);
  }

  play() {
    if (this.audio.src && this.audio.paused && !this.audio.ended) {
      this._playing = true;
      this.audio.play();
    } else {
      this.playFrom(this.index);
    }
  }

  pause() { this._playing = false; this.audio.pause(); }
  isPaused() { return this.audio.paused; }

  stop() {
    this._playing = false;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  next() { this.playFrom(this.index + 1); }
  prev() { this.playFrom(Math.max(0, this.index - 1)); }
}
