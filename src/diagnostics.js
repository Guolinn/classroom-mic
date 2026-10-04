// These are individual stages, never a microphone-to-speaker latency estimate.
const milliseconds = seconds => Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
const value = number => Number.isFinite(number) && number >= 0 ? number : null;

export class AudioDiagnostics {
  async sample(engine) {
    const peer = engine.pc;
    const grant = engine.grant;
    const mode = engine.mode;
    const active = !!grant;
    const track = engine.stream?.getAudioTracks()[0];
    const settings = track?.getSettings?.() || {};
    const report = {
      role: engine.role,
      transport: active ? mode === 'relay' ? 'Server relay' : 'Direct WebRTC' : 'Inactive',
      connection: active && mode === 'direct' ? peer?.connectionState || 'connecting' : null,
      peerRoundTripMs: null,
      receiverJitterMs: null,
      receiverBufferMs: null,
      receiverTargetMs: null,
      packetLossPercent: null,
      relayQueueMs: active && mode === 'relay' && engine.role === 'host' ? milliseconds(Math.max(0, (engine.playAt || 0) - (engine.ctx?.currentTime || 0))) : null,
      relayTargetMs: active && mode === 'relay' && engine.role === 'host' ? milliseconds(engine.playout?.target) : null,
      relayUnderruns: active && mode === 'relay' && engine.role === 'host' ? value(engine.playout?.underruns) : null,
      relayResyncs: active && mode === 'relay' && engine.role === 'host' ? value(engine.playout?.resyncs) : null,
      captureLatencyMs: milliseconds(settings.latency),
      sampleRate: value(settings.sampleRate ?? engine.ctx?.sampleRate),
      echoCancellation: settings.echoCancellation ?? null,
      noiseSuppression: settings.noiseSuppression ?? null,
      voiceIsolation: settings.voiceIsolation ?? null,
      // The AudioContext output estimate does not describe the native media
      // element used for direct playback, so do not report it for that path.
      relayOutputLatencyMs: active && mode === 'relay' && engine.role === 'host' ? milliseconds(engine.ctx?.outputLatency) : null,
    };
    if (!active || mode !== 'direct' || !peer) { this.previous = null; return report; }
    let stats;
    try { stats = await peer.getStats(); } catch { this.previous = null; return report; }
    // A mute, speaker switch or fallback may occur while stats are pending.
    if (engine.pc !== peer || engine.grant !== grant || engine.mode !== mode) { this.previous = null; return null; }
    const rows = [...stats.values()];
    const transport = rows.find(row => row.type === 'transport' && row.selectedCandidatePairId);
    const pair = transport ? stats.get(transport.selectedCandidatePairId) : rows.find(row => row.type === 'candidate-pair' && row.state === 'succeeded' && (row.selected || row.nominated));
    report.peerRoundTripMs = milliseconds(pair?.currentRoundTripTime);
    const inbound = rows.find(row => row.type === 'inbound-rtp' && (row.kind === 'audio' || row.mediaType === 'audio') && !row.isRemote);
    if (!inbound) { this.previous = null; return report; }
    report.receiverJitterMs = milliseconds(inbound.jitter);
    const previous = this.previous;
    const sameStream = previous?.peer === peer && previous.grant === grant && previous.row.id === inbound.id;
    if (sameStream) {
      const old = previous.row;
      const emitted = inbound.jitterBufferEmittedCount - old.jitterBufferEmittedCount;
      if (Number.isFinite(emitted) && emitted > 0) {
        report.receiverBufferMs = milliseconds((inbound.jitterBufferDelay - old.jitterBufferDelay) / emitted);
        report.receiverTargetMs = milliseconds((inbound.jitterBufferTargetDelay - old.jitterBufferTargetDelay) / emitted);
      }
      const received = inbound.packetsReceived - old.packetsReceived;
      const lost = inbound.packetsLost - old.packetsLost;
      if (Number.isFinite(received) && Number.isFinite(lost) && received >= 0 && lost >= 0 && received + lost > 0) report.packetLossPercent = Math.round(lost / (received + lost) * 1000) / 10;
    }
    this.previous = { peer, grant, row: { ...inbound } };
    return report;
  }
}

export function formatDiagnosticMs(number) { return number === null || number === undefined ? 'Unavailable' : `${number} ms`; }
