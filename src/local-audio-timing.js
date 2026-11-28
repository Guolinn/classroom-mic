const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
const positive = value => Number.isFinite(value) && value > 0 ? value : null;
const summaryFields = ['receiptMedianMs', 'receiptP95Ms', 'receiptSamples', 'transportRttMs', 'transportMinRttMs', 'transportRttVariationMs', 'maxCaptureGapMs', 'maxDispatchLagMs', 'maxSendGapMs', 'maxWriteMs'];

// Sample existing audio packets; no probe audio, retransmission or clock sync.
// Replies measure a round trip, including browser and receiver scheduling.
export class LocalAudioTiming {
  constructor(transport, { now = () => performance.now() } = {}) {
    this.transport = transport; this.now = now; this.pending = new Map();
    this.samples = []; this.next = 0; this.stopped = false; this.network = {};
    try { this.reader = transport.datagrams?.readable?.getReader(); } catch {}
    if (this.reader) this.read().catch(() => {});
  }
  writer(writer) {
    this.rawWriter = writer;
    return { write: bytes => {
      if (!this.stopped && bytes?.byteLength === 492) {
        const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
        if (seq % 20 === 0) {
          this.pending.set(seq, this.now());
          // Older receivers do not reply. Storage must remain bounded.
          if (this.pending.size > 32) this.pending.delete(this.pending.keys().next().value);
        }
      }
      return writer.write(bytes);
    } };
  }
  async read() {
    while (!this.stopped) {
      const { done, value } = await this.reader.read();
      if (done || this.stopped) return;
      if (value?.byteLength !== 8) continue;
      const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
      if (view.getUint32(0, true) !== 0x3141544d) continue; // MTA1
      const seq = view.getUint32(4, true), sent = this.pending.get(seq);
      if (sent === undefined) continue;
      this.pending.delete(seq);
      const elapsed = this.now() - sent;
      if (elapsed < 0 || elapsed > 3000) continue;
      this.samples[this.next] = elapsed; this.next = (this.next + 1) % 128;
    }
  }
  async poll() {
    if (this.stopped || this.polling || typeof this.transport.getStats !== 'function') return;
    this.polling = true;
    try {
      const stats = await this.transport.getStats();
      if (!this.stopped) this.network = {
        // Some implementations return all-zero placeholders. Do not present
        // those as a measured zero-latency connection.
        transportRttMs: positive(stats.smoothedRtt),
        transportMinRttMs: positive(stats.minRtt),
        transportRttVariationMs: positive(stats.smoothedRtt) === null ? null : finite(stats.rttVariation),
        transportExpired: finite(stats.datagrams?.expiredOutgoing),
        transportLost: finite(stats.datagrams?.lostOutgoing),
      };
    } catch { /* Unsupported or failed measurement must not stop audio. */ }
    finally { this.polling = false; }
  }
  snapshot() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    return { ...this.network, receiptSamples: sorted.length,
      receiptMedianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      receiptP95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] : null };
  }
  publish(senderStats) {
    // Only a new receiver that acknowledged audio understands this message.
    // Send bounded numerical diagnostics to the paired Mac, never the cloud.
    if (this.stopped || !this.samples.length || this.reporting || !this.rawWriter) return;
    const source = { ...senderStats, ...this.snapshot() }, report = {};
    for (const key of summaryFields) report[key] = finite(source[key]);
    const bytes = new TextEncoder().encode('MTS1' + JSON.stringify(report));
    if (bytes.byteLength > 512) return;
    this.reporting = true;
    try { Promise.resolve(this.rawWriter.write(bytes)).catch(() => {}).finally(() => { this.reporting = false; }); }
    catch { this.reporting = false; }
  }
  close() { this.stopped = true; this.pending.clear(); this.reader?.cancel().catch(() => {}); }
}
