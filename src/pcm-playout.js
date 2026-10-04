// Schedule relay audio close to real time. The browser output device and
// transport may add latency beyond this queue; this is not a total-latency cap.
export class PcmPlayout {
  constructor() { this.reset(); }
  reset() {
    this.playAt = 0;
    this.started = false;
    this.target = .02;
    this.underruns = 0;
    this.resyncs = 0;
  }
  schedule(now, duration) {
    if (!Number.isFinite(now) || now < 0 || !Number.isFinite(duration) || duration <= 0 || duration > .04) return null;
    let reset = !this.started;
    if (this.started && this.playAt < now) {
      // Favor continuity after a missed deadline. Reset for each new speaker,
      // so a previous student's poor connection cannot penalize the next one.
      this.underruns++;
      this.target = .04;
      reset = true;
    } else if (this.started && this.playAt + duration > now + .14 + 1e-6) {
      // Include the incoming frame in the cap, rather than checking only the
      // already queued audio. Discard old scheduled sources on a resync.
      this.resyncs++;
      this.target = .04;
      reset = true;
    }
    const at = reset ? now + this.target : this.playAt;
    this.playAt = at + duration;
    this.started = true;
    return { at, reset };
  }
}
