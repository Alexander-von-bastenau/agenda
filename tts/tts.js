// Flemish neural voice that runs inside the page (Piper nl_BE voices + onnxruntime-web).
// Model files are packed in wasm custom sections because the host only serves certain file types.
window.FlemishTTS = (() => {
  const BASE = new URL('tts/', location.href).href;
  const PARTS = 4;
  let ort = null, ph = null, phOut = [], sess = null, cfg = null, cur = '', loading = null;
  let ctx = null, src = null, gen = 0, onProgress = () => {};

  const loadScript = u => new Promise((ok, bad) => {
    if ([...document.scripts].some(s => s.src === u)) return ok();
    const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = () => bad(new Error('script ' + u)); document.head.appendChild(s);
  });
  // read a wasm file whose first (custom) section holds raw bytes
  function unpack(buf) {
    const b = new Uint8Array(buf); let p = 9;
    const leb = () => { let r = 0, s = 0, x; do { x = b[p++]; r |= (x & 127) << s; s += 7; } while (x & 128); return r >>> 0; };
    leb(); const nl = leb(); p += nl; return b.subarray(p);
  }
  const progress = { got: 0, total: 1 };
  async function fetchBuf(u, expect) {
    const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status);
    if (!r.body || !expect) { const a = await r.arrayBuffer(); progress.got += a.byteLength; onProgress(progress.got / progress.total); return a; }
    const rd = r.body.getReader(), chunks = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); n += value.length; progress.got += value.length; onProgress(Math.min(.99, progress.got / progress.total)); }
    const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out.buffer;
  }

  function load(voice) {
    if (loading && cur === voice) return loading;
    cur = voice; progress.got = 0; progress.total = 15.8e6 * PARTS + 18.1e6 + 15.5e6;
    loading = (async () => {
      await loadScript(BASE + 'ort.wasm.min.js');
      await loadScript(BASE + 'piper_phonemize.js');
      ort = window.ort;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = { mjs: BASE + 'ort-wasm-simd-threaded.js', wasm: BASE + 'ort-wasm-simd-threaded.wasm' };
      const [phWasm, phData, conf, ...parts] = await Promise.all([
        ph ? null : fetchBuf(BASE + 'piper_phonemize.wasm'),
        ph ? null : fetchBuf(BASE + 'piper_phonemize-data.wasm', true),
        fetch(BASE + voice + '.json').then(r => r.json()),
        ...[...Array(PARTS)].map((_, i) => fetchBuf(`${BASE}${voice}-${i}.wasm`, true))
      ]);
      cfg = conf;
      if (!ph) {
        const data = unpack(phData);
        ph = await window.createPiperPhonemize({
          wasmBinary: phWasm,
          getPreloadedPackage: () => data.slice().buffer,
          print: d => phOut.push(d), printErr: () => {}, locateFile: u => BASE + u
        });
      }
      const bins = parts.map(unpack), size = bins.reduce((a, b) => a + b.length, 0), model = new Uint8Array(size);
      let o = 0; for (const b of bins) { model.set(b, o); o += b.length; }
      sess = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      onProgress(1);
    })();
    loading.catch(() => { loading = null; cur = ''; });
    return loading;
  }

  async function synth(text, speed) {
    phOut = [];
    ph.callMain(['-l', cfg.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
    const ids = phOut.flatMap(l => JSON.parse(l).phoneme_ids);
    const inf = cfg.inference;
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale, inf.length_scale / speed, inf.noise_w]), [3])
    };
    if (Object.keys(cfg.speaker_id_map || {}).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    const out = await sess.run(feeds);
    return out.output.data;
  }

  // must be called directly inside the tap, before any await (iOS audio unlock)
  function unlock() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state !== 'running') ctx.resume();
      const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start();
    } catch (e) {}
  }
  function playPcm(pcm, rate, my) {
    return new Promise(res => {
      if (my !== gen) return res();
      const buf = ctx.createBuffer(1, pcm.length, rate); buf.getChannelData(0).set(pcm);
      const s = ctx.createBufferSource(); s.buffer = buf;
      const g = ctx.createGain(); g.gain.value = 0.95; s.connect(g); g.connect(ctx.destination);
      s.onended = () => res(); src = s; s.start();
    });
  }
  const cache = new Map();
  async function say(lines, { voice = 'nathalie', speed = .9, progress: pr, onLine } = {}) {
    const my = ++gen; onProgress = pr || (() => {});
    await load(voice); if (my !== gen) return;
    const rate = cfg.audio.sample_rate, gap = new Float32Array(Math.round(rate * .28));
    const get = t => { const k = voice + speed + t; if (!cache.has(k)) cache.set(k, synth(t, speed)); return cache.get(k); };
    let next = get(lines[0]);
    for (let i = 0; i < lines.length; i++) {
      const pcm = await next; if (my !== gen) return;
      if (i + 1 < lines.length) next = get(lines[i + 1]);
      try { onLine && onLine(i); } catch (e) {}
      await playPcm(pcm, rate, my); if (my !== gen) return;
      if (i + 1 < lines.length) await playPcm(gap, rate, my);
    }
    if (cache.size > 80) cache.clear();
  }
  function stop() { gen++; try { src && src.stop(); } catch (e) {} }
  return { say, stop, unlock, load, ready: () => !!sess, test: async (t, v = 'nathalie') => { await load(v); return synth(t, .9); } };
})();
