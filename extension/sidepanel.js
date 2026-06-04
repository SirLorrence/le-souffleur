import { extract, getVoices } from "./lib/api.js";
import { Reader } from "./lib/reader.js";
import { Player } from "./lib/player.js";
import { SyncController } from "./lib/sync.js";
import { wireControls } from "./lib/controls.js";

window.SOUFFLEUR_BASE = "http://localhost:8000";

const $ = (id) => document.getElementById(id);
const state = { segments: [], outline: [], voice: "af_heart" };

async function init() {
  try {
    const voices = await getVoices();
    const select = $("voice-select");
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.name;
      select.appendChild(opt);
    }
    state.voice = voices[0]?.id || "af_heart";
    select.value = state.voice;
  } catch (err) {
    console.warn("voices unavailable", err);
  }
  $("load-btn").addEventListener("click", loadCurrentPage);
}

async function loadCurrentPage() {
  const errEl = $("start-error");
  errEl.hidden = true;
  $("load-btn").disabled = true;
  $("load-btn").textContent = "Reading…";
  try {
    const cap = await chrome.runtime.sendMessage({ type: "capture" });
    if (!cap || cap.error) {
      throw new Error((cap && cap.error) || "Couldn't capture this page.");
    }
    const doc = await extract({ html: cap.html, source_url: cap.url });
    if (!doc.segments.length) {
      throw new Error("Couldn't find readable content on this page.");
    }
    state.segments = doc.segments;
    state.outline = doc.outline;
    startReader();
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    errEl.textContent = /Failed to fetch|NetworkError/.test(msg)
      ? "Start le souffleur first — run ./dev.sh"
      : msg;
    errEl.hidden = false;
  } finally {
    $("load-btn").disabled = false;
    $("load-btn").innerHTML = "&#9658; Read this page";
  }
}

function sectionTitleFor(sectionIndex) {
  const o = state.outline.find((o) => o.sectionIndex === sectionIndex);
  return o ? o.title : "";
}

function startReader() {
  $("start").hidden = true;
  $("reader").hidden = false;

  const reader = new Reader($("content"), $("outline-nav"));
  reader.render(state.segments, state.outline);

  const player = new Player(state.segments, {
    getVoice: () => state.voice,
    onBuffering: (on) => {
      if (on) $("section-label").textContent = "buffering…";
    },
    onSentenceStart: (seg, words) => {
      sync.beginSentence(seg.id, words);
      reader.highlightOutline(seg.sectionIndex);
      $("section-label").textContent = sectionTitleFor(seg.sectionIndex);
    },
    onEnded: () => { $("section-label").textContent = "done"; },
  });

  const sync = new SyncController(player.audio, reader, {
    onProgress: (frac) => { $("scrubber-fill").style.width = `${Math.min(100, frac * 100)}%`; },
  });

  const controls = wireControls({
    player,
    els: {
      playBtn: $("play-btn"), nextBtn: $("next-btn"), prevBtn: $("prev-btn"),
      stopBtn: $("stop-btn"), speedInput: $("speed-input"), speedLabel: $("speed-label"),
      voiceSelect: $("voice-select"),
    },
    onVoiceChange: (id) => { state.voice = id; },
  });

  reader.onWordClick((segmentId) => {
    player.playFrom(state.segments.findIndex((s) => s.id === segmentId));
    controls.setPlayIcon();
  });

  const openDrawer = () => { $("drawer").hidden = false; $("drawer-scrim").hidden = false; };
  const closeDrawer = () => { $("drawer").hidden = true; $("drawer-scrim").hidden = true; };

  reader.onSectionJump((sectionIndex) => {
    const id = reader.firstSegmentOfSection(state.segments, sectionIndex);
    reader.scrollToSection(sectionIndex);
    closeDrawer();
    player.playFrom(state.segments.findIndex((s) => s.id === id));
    controls.setPlayIcon();
  });

  $("outline-btn").addEventListener("click", () => {
    if ($("drawer").hidden) openDrawer(); else closeDrawer();
  });
  $("drawer-scrim").addEventListener("click", closeDrawer);
}

init();
