class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * .02);
    this.samples = new Int16Array(this.size);
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => { if (data === 'stop') this.stopped = true; };
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const value of input) {
      this.samples[this.offset++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
      if (this.offset === this.size) {
        this.port.postMessage({ samples: this.samples.buffer, sampleRate }, [this.samples.buffer]);
        this.samples = new Int16Array(this.size);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
