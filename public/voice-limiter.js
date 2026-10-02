// A peak limiter with 3 ms of lookahead and no makeup gain. Quiet speech is
// preserved; there is no noise gate and background sound is never boosted.
export class VoiceLimiter {
  constructor(rate) {
    this.delay = Math.ceil(rate * .003);
    this.buffer = new Float32Array(this.delay + 1);
    this.peaks = new Float64Array(this.delay + 2);
    this.indices = new Float64Array(this.peaks.length);
    this.head = 0; this.tail = 0; this.index = 0; this.gain = 1;
    this.ceiling = .89;
    this.recovery = Math.exp(-1 / (rate * .06));
  }
  process(value) {
    const sample = Number.isFinite(value) ? value : 0;
    const n = this.index++, count = this.peaks.length, magnitude = Math.abs(sample);
    // A monotonic queue finds the peak in the lookahead window without
    // allocating objects or scanning the entire window for every sample.
    while (this.head !== this.tail && this.indices[this.head] < n - this.delay) this.head = (this.head + 1) % count;
    while (this.head !== this.tail) {
      const last = (this.tail + count - 1) % count;
      if (this.peaks[last] > magnitude) break;
      this.tail = last;
    }
    this.peaks[this.tail] = magnitude; this.indices[this.tail] = n;
    this.tail = (this.tail + 1) % count;
    const peak = this.peaks[this.head];
    const target = peak > this.ceiling ? this.ceiling / peak : 1;
    this.gain = target < this.gain ? target : target + this.recovery * (this.gain - target);
    const slot = n % this.buffer.length;
    this.buffer[slot] = sample;
    return this.buffer[(slot + 1) % this.buffer.length] * this.gain;
  }
}
