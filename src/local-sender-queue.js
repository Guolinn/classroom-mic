// Bounded datagram writes, shared by the worker and compatibility path.
// Timing describes software stages only, not microphone-to-speaker delay.
export class LocalSenderQueue {
  constructor(writer, failed, { now = () => performance.now(), wallNow = () => Date.now(), stale = () => false } = {}) {
    this.writer = writer; this.failed = failed; this.now = now; this.wallNow = wallNow; this.stale = stale;
    this.pending = 0; this.lastSend = null; this.stopped = false;
    this.stats = { sent: 0, dropped: 0, maxCaptureGapMs: 0, maxDispatchLagMs: 0, maxSendGapMs: 0, maxWriteMs: 0 };
  }
  accept(data) {
    if (this.stopped || data?.buffer?.byteLength !== 492) return;
    const lag = Number.isFinite(data.producedAt) ? Math.max(0, this.wallNow() - data.producedAt) : 0;
    this.stats.maxDispatchLagMs = Math.max(this.stats.maxDispatchLagMs, lag);
    if (Number.isFinite(data.maxCaptureGapMs)) this.stats.maxCaptureGapMs = Math.max(this.stats.maxCaptureGapMs, data.maxCaptureGapMs);
    if (this.pending >= 3 || lag > 30 || this.stale(data)) { this.stats.dropped++; return; }
    const start = this.now();
    if (this.lastSend !== null) this.stats.maxSendGapMs = Math.max(this.stats.maxSendGapMs, start - this.lastSend);
    this.lastSend = start; this.pending++; this.stats.sent++;
    try {
      Promise.resolve(this.writer.write(new Uint8Array(data.buffer))).catch(() => { if (!this.stopped) this.failed(); }).finally(() => {
        this.pending--; this.stats.maxWriteMs = Math.max(this.stats.maxWriteMs, this.now() - start);
      });
    } catch { this.pending--; if (!this.stopped) this.failed(); }
  }
  close() { this.stopped = true; }
}
