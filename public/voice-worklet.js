import { VoiceLimiter } from './voice-limiter.js';

class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.limiter = new VoiceLimiter(sampleRate);
    this.stopped = false;
    this.port.onmessage = ({ data }) => { if (data === 'stop') this.stopped = true; };
  }
  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (this.stopped) { output?.fill(0); return false; }
    const input = inputs[0]?.[0];
    if (output) for (let i = 0; i < output.length; i++) output[i] = this.limiter.process(input?.[i] || 0);
    return true;
  }
}
registerProcessor('voice-processor', VoiceProcessor);
