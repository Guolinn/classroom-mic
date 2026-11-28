// These are individual stages, never a microphone-to-speaker latency estimate.
const milliseconds = seconds => Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
const value = number => Number.isFinite(number) && number >= 0 ? number : null;
const signedValue = number => Number.isFinite(number) ? number : null;
export const localStageLabels = {
  connecting: 'Connecting to receiver',
  'starting-capture': 'Starting microphone processing',
  'waiting-audio': 'Waiting for microphone audio',
  sending: 'Sending audio',
  'waiting-phone': 'Waiting for phone audio',
  'audio-received': 'Audio received',
  disconnected: 'Receiver disconnected',
};

export class AudioDiagnostics {
  async sample(engine) {
    const peer = engine.pc;
    const grant = engine.grant;
    const mode = engine.mode;
    const active = !!grant;
    const track = engine.stream?.getAudioTracks()[0];
    const settings = track?.getSettings?.() || {};
    const sender = active && mode === 'local' && engine.role === 'student' ? engine.localSenderStats : null;
    const localOutput = active && mode === 'local' && engine.role === 'host' ? engine.localReceiver?.stats : null;
    const timing = sender || (active && mode === 'local' && engine.role === 'host' ? engine.localReceiver?.senderTiming : null);
    let localStage = null;
    if (active && mode === 'local') {
      if (engine.role === 'host') {
        localStage = engine.localReceiver?.connected === false ? 'disconnected'
          : value(localOutput?.received) > 0 ? 'audio-received' : 'waiting-phone';
      } else if (Object.hasOwn(localStageLabels, engine.localStage)) localStage = engine.localStage;
    }
    const report = {
      role: engine.role,
      transport: active ? mode === 'local' ? 'Local receiver' : mode === 'relay' ? 'Server relay' : 'Direct WebRTC' : 'Inactive',
      localStage,
      audioContextState: ['running', 'suspended', 'interrupted', 'closed'].includes(engine.ctx?.state) ? engine.ctx.state : null,
      microphoneTrackState: ['live', 'ended'].includes(track?.readyState) ? track.readyState : null,
      microphoneEnabled: typeof track?.enabled === 'boolean' ? track.enabled : null,
      pageVisibility: typeof document !== 'undefined' ? document.visibilityState : null,
      localQueueMs: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.queueMs) : null,
      localTargetMs: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.targetMs) : null,
      localUnderruns: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.underruns) : null,
      localDropped: active && mode === 'local' ? value(engine.role === 'host' ? engine.localReceiver?.stats?.dropped : engine.localDropped) : null,
      localReceived: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.received) : null,
      localPlayedSamples: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.playedSamples) : null,
      localOutputCallbacks: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.outputCallbacks) : null,
      localResets: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.resets) : null,
      localReceiverVersion: engine.role === 'host' ? engine.localReceiver?.version ?? null : null,
      localTrims: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.trims) : null,
      localTrimmedMs: active && mode === 'local' && engine.role === 'host' ? milliseconds(value(engine.localReceiver?.stats?.trimmedSamples) === null ? undefined : engine.localReceiver.stats.trimmedSamples / 48000) : null,
      localMaxArrivalGapMs: active && mode === 'local' && engine.role === 'host' ? value(engine.localReceiver?.stats?.maxArrivalGapMs) : null,
      localQueueFloorMs: value(localOutput?.queueFloorMs),
      localQueuePeakMs: value(localOutput?.queuePeakMs),
      localClockCorrectionPpm: signedValue(localOutput?.clockCorrectionPpm),
      localMaxOutputGapMs: value(localOutput?.maxOutputGapMs),
      localOutputBlockMs: value(localOutput?.outputBlockMs),
      localCatchupEvents: value(localOutput?.catchups),
      localCatchupMs: milliseconds(value(localOutput?.compressedSamples) === null ? undefined : localOutput.compressedSamples / 48000),
      localResidenceMedianMs: value(localOutput?.residenceMedianMs),
      localResidenceP95Ms: value(localOutput?.residenceP95Ms),
      localResidenceSamples: value(localOutput?.residenceSamples),
      localBacklogSpeedupPercent: value(localOutput?.backlogSpeedupPercent),
      localReceiptMedianMs: value(timing?.receiptMedianMs),
      localReceiptP95Ms: value(timing?.receiptP95Ms),
      localReceiptSamples: value(timing?.receiptSamples),
      localTransportRttMs: value(timing?.transportRttMs),
      localTransportMinRttMs: value(timing?.transportMinRttMs),
      localTransportRttVariationMs: value(timing?.transportRttVariationMs),
      localTransportExpired: value(sender?.transportExpired),
      localTransportLost: value(sender?.transportLost),
      localSent: active && mode === 'local' && engine.role === 'student' ? value(engine.localSent) : null,
      localSenderPath: sender?.path ?? null,
      localMaxCaptureGapMs: value(timing?.maxCaptureGapMs),
      localMaxDispatchLagMs: value(timing?.maxDispatchLagMs),
      localMaxSendGapMs: value(timing?.maxSendGapMs),
      localMaxWriteMs: value(timing?.maxWriteMs),
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

export function formatDiagnosticMs(number) { return number === null || number === undefined ? 'Unavailable' : `${Math.round(number * 10) / 10} ms`; }
