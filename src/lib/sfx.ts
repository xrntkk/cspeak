// Simple synthesized join/leave chimes via Web Audio — no asset files needed.
let ctx: AudioContext | null = null;

function tone(freq: number, durationMs: number) {
  try {
    if (!ctx) ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + durationMs / 1000,
    );
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // audio not available; ignore
  }
}

/// Rising chime when someone joins your channel.
export function playJoin() {
  tone(660, 120);
  setTimeout(() => tone(880, 140), 90);
}

/// Falling chime when someone leaves your channel.
export function playLeave() {
  tone(660, 120);
  setTimeout(() => tone(440, 160), 90);
}
