// Five-millisecond, 48 kHz, mono PCM16 datagrams. No audio is recorded.
class LocalPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Int16Array(240); this.offset = 0; this.seq = 0;
    this.phase = 0; this.previous = 0; this.stopped = false;
    this.port.onmessage = ({ data }) => { if (data === 'stop') this.stopped = true; };
  }
  sample(value) {
    this.frame[this.offset++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
    if (this.offset !== 240) return;
    const buffer = new ArrayBuffer(492), view = new DataView(buffer);
    view.setUint32(0, 0x3130544d, true); // MT01
    view.setUint32(4, this.seq++, true); view.setUint32(8, 48000, true);
    for (let i = 0; i < 240; i++) view.setInt16(12 + i * 2, this.frame[i], true);
    this.port.postMessage({ buffer, contextTime: currentTime }, [buffer]); this.offset = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0]; if (!input?.length) return true;
    if (sampleRate === 48000) { for (const value of input) this.sample(value); }
    else {
      // Streaming linear resampling keeps packet duration fixed at 44.1 kHz too.
      while (this.phase < input.length - 1) {
        const left = Math.floor(this.phase), frac = this.phase - left;
        const a = left < 0 ? this.previous : input[left];
        this.sample(a + (input[left + 1] - a) * frac); this.phase += sampleRate / 48000;
      }
      this.phase -= input.length; this.previous = input[input.length - 1];
    }
    return true;
  }
}
registerProcessor('local-pcm-capture', LocalPcmCapture);
