/** Small synthesised sounds so the game needs no audio files. */
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  const a = ac();
  if (!a || muted) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

function noise(dur: number, gain: number, cutoff: number) {
  const a = ac();
  if (!a || muted) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  setMuted(m: boolean) {
    muted = m;
  },
  isMuted: () => muted,
  shatter() {
    noise(0.5, 0.5, 1800);
    tone(90, 0, 0.3, "sine", 0.4);
  },
  pick() {
    tone(520, 0, 0.05, "triangle", 0.08);
  },
  /** Pitch climbs as the object nears completion. */
  snap(progress: number) {
    const base = 420 + progress * 380;
    noise(0.05, 0.25, 4000);
    tone(base, 0, 0.09, "square", 0.07);
    tone(base * 1.5, 0.05, 0.14, "triangle", 0.1);
  },
  miss() {
    tone(160, 0, 0.14, "sawtooth", 0.06);
  },
  hint() {
    tone(880, 0, 0.1, "sine", 0.08);
    tone(1175, 0.09, 0.16, "sine", 0.08);
  },
  complete() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.35, "triangle", 0.12));
  },
};
