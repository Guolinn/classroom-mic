// Detect only persistent, nearly pure tones. Speech and room reverberation are
// not equivalent to feedback; leave broadband and harmonic signals alone.
export class FeedbackDetector {
  constructor(sampleRate, fftSize = 2048) {
    this.binWidth = sampleRate / fftSize;
    this.first = Math.max(3, Math.ceil(180 / this.binWidth));
    this.last = Math.min(fftSize / 2 - 4, Math.floor(8000 / this.binWidth));
    this.maxPeak = Math.min(this.last, Math.floor(5000 / this.binWidth));
    this.powers = new Float64Array(fftSize / 2);
    this.accepted = [];
    this.reset();
  }
  reset() { this.candidate = 0; this.since = 0; this.lastTime = null; }
  read(spectrum, time) {
    if (!Number.isFinite(time) || spectrum.length !== this.powers.length) { this.reset(); return null; }
    if (this.lastTime === null || time <= this.lastTime || time - this.lastTime > .2) this.candidate = 0;
    this.lastTime = time;
    let total = 0, peak = this.first;
    for (let i = this.first; i <= this.last; i++) {
      this.powers[i] = Number.isFinite(spectrum[i]) ? 10 ** (spectrum[i] / 10) : 0;
      total += this.powers[i];
      if (i <= this.maxPeak && this.powers[i] > this.powers[peak]) peak = i;
    }
    let band = 0, weighted = 0;
    for (let i = peak - 2; i <= peak + 2; i++) {
      const power = this.powers[i] || 0;
      band += power; weighted += i * power;
    }
    // A quiet tone, speech harmonics, or broad noise must not trigger a cut.
    if (this.powers[peak] < 10 ** (-45 / 10) || !total || band / total < .86) { this.candidate = 0; return null; }
    const frequency = weighted / band * this.binWidth;
    if (this.accepted.some(f => Math.abs(f - frequency) < Math.max(f * .06, this.binWidth * 2))) { this.candidate = 0; return null; }
    if (!this.candidate || Math.abs(frequency - this.candidate) > this.binWidth * 1.5) {
      this.candidate = frequency; this.since = time; return null;
    }
    if (time - this.since < .6 || this.accepted.length >= 2) return null;
    this.accepted.push(frequency); this.candidate = 0;
    return frequency;
  }
}

export class FeedbackGuard {
  constructor(ctx, input, output, isActive) {
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0;
    this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.detector = new FeedbackDetector(ctx.sampleRate, this.analyser.fftSize);
    this.filters = Array.from({ length: 2 }, () => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking'; filter.Q.value = 18; filter.gain.value = 0;
      return filter;
    });
    // Analyse before the cuts, but keep this branch silent. The audio path
    // remains streaming; spectral analysis adds no playout buffer.
    this.silent = ctx.createGain(); this.silent.gain.value = 0;
    input.connect(this.analyser); this.analyser.connect(this.silent); this.silent.connect(ctx.destination);
    input.connect(this.filters[0]); this.filters[0].connect(this.filters[1]); this.filters[1].connect(output);
    this.timer = setInterval(() => {
      if (!isActive() || ctx.state !== 'running') { this.detector.reset(); return; }
      this.analyser.getFloatFrequencyData(this.spectrum);
      const frequency = this.detector.read(this.spectrum, ctx.currentTime);
      if (frequency === null) return;
      const filter = this.filters[this.detector.accepted.length - 1];
      filter.frequency.setValueAtTime(frequency, ctx.currentTime);
      filter.gain.setTargetAtTime(-9, ctx.currentTime, .03);
    }, 80);
  }
  stop() {
    clearInterval(this.timer);
    this.analyser.disconnect(); this.silent.disconnect();
    for (const filter of this.filters) filter.disconnect();
  }
}
