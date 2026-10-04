import React, { useEffect, useRef, useState } from 'react';
import { AudioDiagnostics, formatDiagnosticMs } from './diagnostics';

export function AudioDetails({ engine }) {
  const [open, setOpen] = useState(false), [report, setReport] = useState(null), [copied, setCopied] = useState(false);
  const copiedTimer = useRef();
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  useEffect(() => {
    if (!open) return;
    let cancelled = false, timer;
    const sampler = new AudioDiagnostics();
    async function poll() {
      try {
        const snapshot = engine.current ? await sampler.sample(engine.current) : null;
        if (!cancelled) setReport(snapshot);
      } catch { if (!cancelled) setReport(null); }
      finally { if (!cancelled) timer = setTimeout(poll, 1000); }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, engine]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ at: new Date().toISOString(), ...report, scope: 'Individual audio stages. Not total microphone-to-speaker latency. No audio, names, room codes, credentials or network addresses included.' }, null, 2));
      setCopied(true); clearTimeout(copiedTimer.current); copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  }
  const yesNo = v => v === true ? 'On' : v === false ? 'Off' : v ?? 'Unavailable';
  return <details className="audio-details" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Audio details</summary>
    {open && report && <>
      <dl>
        <dt>Connection</dt><dd>{report.transport}{report.connection ? ` · ${report.connection}` : ''}</dd>
        {report.transport === 'Direct WebRTC' && <><dt>Network round trip</dt><dd>{formatDiagnosticMs(report.peerRoundTripMs)}</dd>
          {report.role === 'host' && <><dt>Receive buffer</dt><dd>{formatDiagnosticMs(report.receiverBufferMs)}</dd><dt>Network jitter</dt><dd>{formatDiagnosticMs(report.receiverJitterMs)}</dd><dt>Recent packet loss</dt><dd>{report.packetLossPercent === null ? 'Unavailable' : `${report.packetLossPercent}%`}</dd></>}
        </>}
        {report.transport === 'Server relay' && report.role === 'host' && <><dt>Playback queue</dt><dd>{formatDiagnosticMs(report.relayQueueMs)}</dd><dt>Buffer target</dt><dd>{formatDiagnosticMs(report.relayTargetMs)}</dd><dt>Buffer underruns</dt><dd>{report.relayUnderruns ?? 'Unavailable'}</dd><dt>Queue resets</dt><dd>{report.relayResyncs ?? 'Unavailable'}</dd><dt>Browser output estimate</dt><dd>{formatDiagnosticMs(report.relayOutputLatencyMs)}</dd></>}
        {report.role === 'student' && <><dt>Capture estimate</dt><dd>{formatDiagnosticMs(report.captureLatencyMs)}</dd><dt>Echo cancellation</dt><dd>{yesNo(report.echoCancellation)}</dd><dt>Noise suppression</dt><dd>{yesNo(report.noiseSuppression)}</dd><dt>Voice isolation</dt><dd>{yesNo(report.voiceIsolation)}</dd></>}
      </dl>
      <p>These measurements cover separate stages, not the total delay to the room speakers.</p>
      <button className="text-button" onClick={copy}>{copied ? 'Copied' : 'Copy details'}</button>
    </>}
  </details>;
}
