// Used only by the isolated synthetic-speech inspection page.
// A connection can stop while its async startup or a test timer is pending.
export async function playSyntheticSpeech({ engine, voice, destination, local, signal,
  onPhase = () => {}, failure = () => '', wait = ms => new Promise(resolve => setTimeout(resolve, ms)), phaseTicks = 100, phaseCount = 2 }) {
  const check = () => {
    if (signal?.aborted) throw new DOMException('Test stopped.', 'AbortError');
    if (engine.destroyed || engine.grant !== 1 || !engine.micSource || !engine.highpass || !engine.worklet) {
      throw new Error(failure() || 'Audio connection stopped. Start a new test from the computer.');
    }
  };
  await engine.sync({ activeId: 'synthetic', grant: 1, mode: 'local', local }, 'synthetic');
  check(); // sync() handles connection errors internally; resolution is not success.
  for (let phase = 0; phase < phaseCount; phase++) {
    check();
    if (phase === 1) engine.micSource.disconnect();
    const source = engine.ctx.createBufferSource();
    try {
      source.buffer = voice; source.loop = true;
      source.connect(phase === 0 ? destination : engine.highpass);
      source.start(); onPhase(phase);
      for (let tick = 0; tick < phaseTicks; tick++) { await wait(100); check(); }
    } finally {
      try { source.stop(); } catch { /* A cancelled source may already be stopped. */ }
      source.disconnect();
    }
  }
  if (!(engine.localSent > 0)) throw new Error('No test audio was sent. Start a new test from the computer.');
}
