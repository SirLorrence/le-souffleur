import { extract, getVoices } from "./api.js";
import { Reader } from "./reader.js";
import { Player } from "./player.js";
import { SyncController } from "./sync.js";
import { wireControls } from "./controls.js";

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
  $("load-btn").addEventListener("click", loadDocument);
}

async function loadDocument() {
  const url = $("url-input").value.trim();
  const text = $("text-input").value.trim();
  const errEl = $("start-error");
  errEl.hidden = true;
  if (!url && !text) {
    errEl.textContent = "Enter a URL or paste some text.";
    errEl.hidden = false;
    return;
  }
  $("load-btn").disabled = true;
  $("load-btn").textContent = "Loading…";
  try {
    const doc = await extract({ url, text });
    if (!doc.segments.length) throw new Error("No readable content found.");
    state.segments = doc.segments;
    state.outline = doc.outline;
    startReader();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    $("load-btn").disabled = false;
    $("load-btn").textContent = "Read this";
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
