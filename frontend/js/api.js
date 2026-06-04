// Thin fetch wrappers around the Rust server. All return Promises.

const base = () => (typeof window !== "undefined" && window.SOUFFLEUR_BASE) || "";

export async function extract({ url, text, html, source_url }) {
  const resp = await fetch(base() + "/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url || null, text: text || null, html: html || null, source_url: source_url || null }),
  });
  if (!resp.ok) {
    let detail = `Extraction failed (${resp.status})`;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch (_) { /* keep default */ }
    throw new Error(detail);
  }
  return resp.json();
}

export async function getVoices() {
  const resp = await fetch(base() + "/voices");
  if (!resp.ok) throw new Error(`Could not load voices (${resp.status})`);
  return resp.json();
}

// Returns an object URL for the synthesized sentence's WAV audio.
export async function synthesizeUrl(text, voiceId) {
  const resp = await fetch(base() + "/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId }),
  });
  if (!resp.ok) throw new Error(`Synthesis failed (${resp.status})`);
  return URL.createObjectURL(await resp.blob());
}
