export class ClassroomAudio {
  constructor(role, send, binary, update) {
    this.role = role; this.send = send; this.binary = binary; this.update = update;
    this.grant = 0; this.mode = 'direct'; this.sources = new Set(); this.queue = Promise.resolve();
    this.iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    this.volume = .5; this.destroyed = false;
  }
  status(status, extra = {}) { if (!this.destroyed) this.update({ status, ...extra }); }
  async context() {
    if (!this.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Audio is not supported. Open this page in Safari or Chrome.');
      this.ctx = new Context({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain(); this.gain.gain.value = this.volume;
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 256;
      this.gain.connect(this.analyser); this.analyser.connect(this.ctx.destination);
      const samples = new Uint8Array(this.analyser.fftSize);
      this.meter = setInterval(() => {
        if (!this.analyser) return;
        const meter = this.role === 'student' && this.micAnalyser ? this.micAnalyser : this.remoteAnalyser || this.analyser;
        meter.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / samples.length);
        this.update({ level: Math.min(1, rms * 4) });
      }, 80);
    }
    await this.ctx.resume();
    return this.ctx;
  }
  async unlock(test = false) {
    const ctx = await this.context();
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    if (test) { gain.gain.linearRampToValueAtTime(.12, ctx.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .5); }
    oscillator.connect(gain); gain.connect(this.gain); oscillator.start(); oscillator.stop(ctx.currentTime + .55);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    this.update({ outputReady: true });
  }
  setVolume(value) { this.volume = value; if (this.gain) this.gain.gain.setTargetAtTime(value, this.ctx.currentTime, .02); if (this.remoteAudio) this.remoteAudio.volume = value; }
  async prepare() {
    if (!window.isSecureContext) throw new Error('Microphone access requires HTTPS. Use the secure website address.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not supported. Open this page in Safari or Chrome.');
    const generation = this.prepareGeneration = (this.prepareGeneration || 0) + 1;
    await this.context();
    if (this.stream?.getAudioTracks().some(t => t.readyState === 'live')) return;
    try {
      if (!this.voiceLoaded) {
        if (!this.ctx.audioWorklet) throw new Error('Audio processing requires an up-to-date Safari or Chrome browser.');
        try { await this.ctx.audioWorklet.addModule('/voice-worklet.js'); }
        catch { throw new Error('Audio processing could not start. Refresh the page and retry.'); }
        this.voiceLoaded = true;
      }
      if (this.destroyed || generation !== this.prepareGeneration) throw new Error('Cancelled. Request to speak again.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } }, video: false });
      if (this.destroyed || generation !== this.prepareGeneration) { stream.getTracks().forEach(t => t.stop()); throw new Error('Cancelled. Request to speak again.'); }
      this.stream = stream;
      stream.getAudioTracks().forEach(t => { t.enabled = false; t.onended = () => {
        if (this.stream !== stream) return;
        this.send({ type: this.grant ? 'finish' : 'cancel' }); this.stopAll();
        this.status('Microphone disconnected. Request to speak again.');
      }; });
      this.micSource = this.ctx.createMediaStreamSource(stream);
      this.highpass = this.ctx.createBiquadFilter();
      this.highpass.type = 'highpass'; this.highpass.frequency.value = 80;
      // High/low-pass Q is in dB: -3.01 dB gives a flat Butterworth response.
      this.highpass.Q.value = 20 * Math.log10(Math.SQRT1_2);
      const processor = this.voiceProcessor = new AudioWorkletNode(this.ctx, 'voice-processor', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
      this.voiceError = () => {
        if (this.voiceProcessor !== processor) return;
        this.send({ type: this.grant ? 'finish' : 'cancel' }); this.stopAll();
        this.status('Audio processing stopped. Request to speak again.');
      };
      processor.addEventListener('processorerror', this.voiceError);
      this.processedDestination = this.ctx.createMediaStreamDestination();
      this.processedDestination.channelCount = 1;
      this.processedStream = this.processedDestination.stream;
      this.processedStream.getTracks().forEach(t => { t.enabled = false; });
      this.micAnalyser = this.ctx.createAnalyser(); this.micAnalyser.fftSize = 256;
      this.micSource.connect(this.highpass); this.highpass.connect(processor);
      processor.connect(this.processedDestination); processor.connect(this.micAnalyser);
      // No microphone signal is connected to the phone's speakers.
      this.status('');
    } catch (e) {
      if (generation === this.prepareGeneration) this.releaseMic();
      if (e.name === 'NotAllowedError') throw new Error('Microphone permission denied. Allow it in your browser settings and retry.');
      if (e.name === 'NotFoundError') throw new Error('No microphone found. Check your device.');
      if (e.name === 'NotReadableError') throw new Error('Microphone unavailable. Close other apps using it and retry.');
      throw e;
    }
  }
  releaseMic() {
    this.prepareGeneration = (this.prepareGeneration || 0) + 1;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.processedStream?.getTracks().forEach(t => t.stop()); this.processedStream = null;
    this.micSource?.disconnect(); this.micSource = null;
    this.highpass?.disconnect(); this.highpass = null;
    if (this.voiceProcessor) {
      this.voiceProcessor.removeEventListener('processorerror', this.voiceError); this.voiceError = null;
      this.voiceProcessor.port.postMessage('stop'); this.voiceProcessor.port.close();
      this.voiceProcessor.disconnect(); this.voiceProcessor = null;
    }
    this.processedDestination?.disconnect(); this.processedDestination = null;
    this.micAnalyser?.disconnect(); this.micAnalyser = null;
  }
  cleanupConnection() {
    clearTimeout(this.fallbackTimer); clearTimeout(this.disconnectTimer);
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null; }
    this.remoteSource?.disconnect(); this.remoteSource = null;
    this.remoteAnalyser?.disconnect(); this.remoteAnalyser = null;
    this.remoteSilent?.disconnect(); this.remoteSilent = null;
    if (this.remoteAudio) { this.remoteAudio.pause(); this.remoteAudio.srcObject = null; this.remoteAudio.remove(); this.remoteAudio = null; }
    if (this.worklet) { this.worklet.port.onmessage = null; this.worklet.port.postMessage('stop'); this.worklet.port.close(); this.worklet.disconnect(); try { this.voiceProcessor?.disconnect(this.worklet); } catch {} this.worklet = null; }
    this.zero?.disconnect(); this.zero = null;
    for (const source of this.sources) { try { source.stop(); } catch {} source.disconnect(); }
    this.sources.clear(); this.playAt = 0; this.candidates = [];
    this.stream?.getTracks().forEach(t => { t.enabled = false; });
    this.processedStream?.getTracks().forEach(t => { t.enabled = false; });
  }
  stopAll() { this.desiredGrant = 0; this.grant = 0; this.cleanupConnection(); this.releaseMic(); this.update({ level: 0, status: '' }); }
  serialize(operation) {
    this.queue = this.queue.then(() => { if (!this.destroyed) return operation(); }).catch(e => { this.status(e.message || 'Audio connection failed.'); if (this.grant) this.send({ type: 'relay', grant: this.grant }); });
    return this.queue;
  }
  sync(state, myId) {
    const newGrant = this.role === 'host' || state.activeId === myId ? state.grant : 0;
    this.desiredGrant = newGrant; this.desiredMode = state.mode;
    // Revoke synchronously: queued negotiation must never keep old audio playing.
    if (this.grant && newGrant !== this.grant) { this.grant = 0; this.cleanupConnection(); if (this.role === 'student') this.releaseMic(); }
    return this.serialize(async () => {
      if (!newGrant || this.desiredGrant !== newGrant || this.desiredMode !== state.mode) return;
      if (this.grant === newGrant && this.mode === state.mode) return;
      this.cleanupConnection(); this.grant = newGrant; this.mode = state.mode;
      if (this.role === 'student' && !this.stream) { this.send({ type: 'finish' }); this.status('Request to speak again to enable your microphone.'); this.grant = 0; return; }
      this.stream?.getTracks().forEach(t => { t.enabled = true; });
      this.processedStream?.getTracks().forEach(t => { t.enabled = true; });
      if (state.mode === 'relay') return this.startRelay(newGrant);
      this.status('Starting audio…');
      const pc = this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.candidates = [];
      pc.onicecandidate = e => { if (e.candidate && this.grant === newGrant) this.send({ type: 'rtc', grant: newGrant, candidate: e.candidate.toJSON() }); };
      pc.ontrack = async e => {
        if (this.role !== 'host' || this.grant !== newGrant) return;
        const ctx = await this.context();
        if (this.grant !== newGrant) return;
        const stream = e.streams[0] || new MediaStream([e.track]);
        // Use the native media element for remote WebRTC playout. A separate,
        // silent Web Audio branch measures levels without doubling the sound.
        if (this.remoteAudio) { this.remoteAudio.pause(); this.remoteAudio.remove(); }
        this.remoteAudio = document.createElement('audio');
        this.remoteAudio.volume = this.volume; this.remoteAudio.autoplay = true;
        this.remoteAudio.setAttribute('playsinline', ''); this.remoteAudio.hidden = true;
        this.remoteAudio.srcObject = stream; document.body.append(this.remoteAudio);
        this.remoteAudio.play().catch(() => this.status('Click Test speaker to enable playback.'));
        this.remoteSource?.disconnect();
        this.remoteSource = ctx.createMediaStreamSource(stream);
        this.remoteAnalyser = ctx.createAnalyser(); this.remoteAnalyser.fftSize = 256;
        this.remoteSilent = ctx.createGain(); this.remoteSilent.gain.value = 0;
        this.remoteSource.connect(this.remoteAnalyser); this.remoteAnalyser.connect(this.remoteSilent); this.remoteSilent.connect(ctx.destination);
      };
      const fallback = () => { if (this.grant === newGrant && this.mode === 'direct') this.send({ type: 'relay', grant: newGrant }); };
      pc.onconnectionstatechange = () => {
        if (this.pc !== pc) return;
        if (pc.connectionState === 'connected') { clearTimeout(this.fallbackTimer); clearTimeout(this.disconnectTimer); this.status(''); }
        if (pc.connectionState === 'failed') fallback();
        if (pc.connectionState === 'disconnected') this.disconnectTimer = setTimeout(fallback, 1500);
      };
      this.fallbackTimer = setTimeout(fallback, 6500);
      if (this.role === 'student') {
        for (const track of this.processedStream.getAudioTracks()) pc.addTrack(track, this.processedStream);
        await pc.setLocalDescription(await pc.createOffer());
        if (this.grant === newGrant) this.send({ type: 'rtc', grant: newGrant, description: pc.localDescription.toJSON() });
      }
    });
  }
  receiveRtc(msg) {
    return this.serialize(async () => {
      const pc = this.pc;
      if (!pc || msg.grant !== this.grant || this.mode !== 'direct') return;
      if (msg.description) {
        // The student is always the offerer, removing negotiation glare.
        if (msg.description.type !== (this.role === 'host' ? 'offer' : 'answer')) return;
        await pc.setRemoteDescription(msg.description);
        for (const candidate of this.candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (this.role === 'host') {
          await pc.setLocalDescription(await pc.createAnswer());
          if (pc === this.pc) this.send({ type: 'rtc', grant: this.grant, description: pc.localDescription.toJSON() });
        }
      } else if (msg.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate); else this.candidates.push(msg.candidate);
      }
    });
  }
  async startRelay(grant) {
    const ctx = await this.context();
    if (this.grant !== grant) return;
    this.status('');
    if (this.role === 'host') return;
    try {
      if (!this.workletLoaded) { await ctx.audioWorklet.addModule('/pcm-worklet.js'); this.workletLoaded = true; }
      if (this.grant !== grant) return;
      this.worklet = new AudioWorkletNode(ctx, 'pcm-capture');
      this.zero = ctx.createGain(); this.zero.gain.value = 0;
      this.voiceProcessor.connect(this.worklet); this.worklet.connect(this.zero); this.zero.connect(ctx.destination);
      this.worklet.port.onmessage = ({ data }) => {
        if (this.grant !== grant || this.mode !== 'relay') return;
        const pcm = new Int16Array(data.samples);
        const buffer = new ArrayBuffer(8 + pcm.byteLength), view = new DataView(buffer);
        view.setUint32(0, grant, true); view.setUint32(4, data.sampleRate, true);
        for (let i = 0; i < pcm.length; i++) view.setInt16(8 + i * 2, pcm[i], true);
        this.binary(buffer);
      };
    } catch { this.send({ type: 'finish' }); this.stopAll(); this.status('Audio relay unavailable. Retry in an up-to-date Safari or Chrome browser.'); }
  }
  receivePcm(buffer) {
    if (!this.ctx || this.role !== 'host' || this.mode !== 'relay' || !this.grant) return;
    const view = new DataView(buffer);
    if (view.byteLength < 10 || view.getUint32(0, true) !== this.grant) return;
    const rate = view.getUint32(4, true), length = (view.byteLength - 8) / 2;
    if (rate < 8000 || rate > 96000) return;
    const audio = this.ctx.createBuffer(1, length, rate), samples = audio.getChannelData(0);
    for (let i = 0; i < length; i++) samples[i] = view.getInt16(8 + i * 2, true) / 32768;
    const now = this.ctx.currentTime;
    if (!this.playAt || this.playAt < now || this.playAt > now + .35) {
      for (const s of this.sources) { try { s.stop(); } catch {} } this.sources.clear();
      this.playAt = now + .06;
    }
    const source = this.ctx.createBufferSource(); source.buffer = audio; source.connect(this.gain);
    this.sources.add(source); source.onended = () => { this.sources.delete(source); source.disconnect(); };
    source.start(this.playAt); this.playAt += audio.duration;
  }
  async destroy() { this.destroyed = true; this.stopAll(); clearInterval(this.meter); await this.ctx?.close(); }
}
