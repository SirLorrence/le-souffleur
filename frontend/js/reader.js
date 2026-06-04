// Renders segments into the content element and exposes element lookups.
export class Reader {
  constructor(contentEl, outlineNavEl) {
    this.contentEl = contentEl;
    this.outlineNavEl = outlineNavEl;
    this._sentenceEls = new Map();    // segmentId -> sentence span
    this._wordEls = new Map();        // segmentId -> [word spans]
    this._sectionAnchors = new Map(); // sectionIndex -> heading element
    this._onWordClick = () => {};
    this._onSectionJump = () => {};
  }

  onWordClick(fn) { this._onWordClick = fn; }
  onSectionJump(fn) { this._onSectionJump = fn; }

  render(segments, outline) {
    this.contentEl.innerHTML = "";
    this._sentenceEls.clear();
    this._wordEls.clear();
    this._sectionAnchors.clear();

    const titleBySection = new Map(outline.map((o) => [o.sectionIndex, o.title]));
    let currentPara = null;
    let lastPara = -1;
    let lastSection = -1;

    for (const seg of segments) {
      if (seg.sectionIndex !== lastSection) {
        lastSection = seg.sectionIndex;
        const title = titleBySection.get(seg.sectionIndex);
        if (title) {
          const h = document.createElement("h2");
          h.className = "heading";
          h.textContent = title;
          this.contentEl.appendChild(h);
          this._sectionAnchors.set(seg.sectionIndex, h);
        }
        currentPara = null;
        lastPara = -1;
      }
      if (seg.paraIndex !== lastPara) {
        currentPara = document.createElement("p");
        this.contentEl.appendChild(currentPara);
        lastPara = seg.paraIndex;
      }
      currentPara.appendChild(this._buildSentence(seg));
      currentPara.appendChild(document.createTextNode(" "));
    }

    this._buildOutline(outline);
  }

  _buildSentence(seg) {
    const span = document.createElement("span");
    span.className = "sentence";
    span.dataset.segId = seg.id;
    const wordEls = [];
    const words = seg.text.split(/\s+/).filter(Boolean);
    words.forEach((word, i) => {
      const w = document.createElement("span");
      w.className = "word";
      w.textContent = word;
      w.addEventListener("click", () => this._onWordClick(seg.id));
      span.appendChild(w);
      if (i < words.length - 1) span.appendChild(document.createTextNode(" "));
      wordEls.push(w);
    });
    this._sentenceEls.set(seg.id, span);
    this._wordEls.set(seg.id, wordEls);
    return span;
  }

  _buildOutline(outline) {
    this.outlineNavEl.innerHTML = "";
    for (const o of outline) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = o.title;
      a.dataset.sectionIndex = o.sectionIndex;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        this._onSectionJump(o.sectionIndex);
      });
      this.outlineNavEl.appendChild(a);
    }
  }

  wordElements(segmentId) { return this._wordEls.get(segmentId) || []; }
  sentenceElement(segmentId) { return this._sentenceEls.get(segmentId); }

  firstSegmentOfSection(segments, sectionIndex) {
    const seg = segments.find((s) => s.sectionIndex === sectionIndex);
    return seg ? seg.id : 0;
  }

  markActiveSentence(segmentId) {
    for (const [id, el] of this._sentenceEls) {
      el.classList.remove("active");
      el.classList.toggle("read", Number(id) < Number(segmentId));
    }
    const active = this._sentenceEls.get(segmentId);
    if (active) { active.classList.add("active"); active.classList.remove("read"); }
  }

  highlightOutline(sectionIndex) {
    for (const a of this.outlineNavEl.querySelectorAll("a")) {
      a.classList.toggle("current", Number(a.dataset.sectionIndex) === Number(sectionIndex));
    }
  }

  scrollToSection(sectionIndex) {
    const el = this._sectionAnchors.get(sectionIndex);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}
