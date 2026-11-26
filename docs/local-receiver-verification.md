# Local receiver verification — November 25, 2026

This release adds an optional experimental mode. The existing WebRTC and WebSocket modes remain the default unless the teacher pairs a local receiver. No claim is made that physical classroom latency has been eliminated or reduced to a particular number.

## Automated checks

- 27 JavaScript tests cover existing behavior plus private-endpoint validation, 48/44.1 kHz capture packetization, per-speaker ticket disclosure, rejection of unauthorized transport changes, failure revocation, diagnostics privacy and cancellation during a delayed local handshake.
- Four Go tests, run with the race detector, exercise continuous native sample consumption, queue clearing on revocation, the controller heartbeat deadline, stale/duplicate frames, burst bounds, malformed input, underrun recovery and reset for a new speaker. `go vet` passes.
- Universal macOS binaries build for arm64 and amd64. Their ad-hoc signature verifies. Intel execution and Apple notarization have not been performed. The release zip includes dependency license notices and a SHA-256 manifest.

## Browser/native checks

The actual localhost teacher/student UI was exercised with an injected synthetic oscillator instead of microphone access. Its signal traversed the application's capture processing graph, five-millisecond PCM AudioWorklet, encrypted browser WebTransport session and native receiver. The teacher approved and muted through the normal controls. The browser's certificate-pin handshake succeeded without disabling TLS validation or installing a root certificate.

An initial sender policy allowed only one outstanding datagram write and dropped normal batched audio callbacks. It was replaced with a maximum of three in-flight writes (15 ms of audio), a requested 15 ms datagram age and a 30 ms worklet-message age check. In one subsequent 8,442-packet synthetic-sink sample, the receiver reported 2 sequence gaps, 3 underruns and 13 queue resets; this is not a glitch-free claim.

A native CoreAudio run at zero volume processed 3,441 received packets and 823,536 audio samples across 6,470 output callbacks. It reported 3 sequence gaps, 8 underruns and 2 queue resets. This exploratory run used the earlier fixed 10 ms recovery target. The final policy starts at 5 ms and increases the target in 5 ms steps after underruns, capped at 20 ms. Buffer targets and queue counters are not total latency measurements.

When the native receiver and the synthetic browser source used the same Mac output device, the browser audio clocks stalled despite reporting `running`. The native test was therefore repeated using a silent browser sink for the synthetic source, isolating its clock from the Mac output device. This is a test-harness configuration, not a change to production microphone capture. It does not establish behavior on a physical iPhone or exclude audio-device compatibility problems on other Macs.

Native revocation can reach a student before the cloud's mute state. Chromium also hid the session close code in one test. The final client gives an opaque transport failure 500 ms for the authoritative state to arrive; this affects error reporting, not playback buffering. The native queue is cleared immediately. The final normal-mute test returned the student to Microphone off without a false disconnection message.

## Public deployment checks

The public HTTPS smoke check passes all eleven checks: certificate, health, create, join, WebSocket upgrade, approval, relay, mute, local permission exchange, failure revocation and end class. GitHub's existing JavaScript test/build workflow passes. Native race tests and builds were run locally; this change does not modify the repository's CI workflow.

Public-origin WebTransport attempts in the in-app browser and desktop Chrome did not finish. The browsers reported the local-network permission as `prompt`; localhost-origin testing had succeeded. Therefore a public-website-to-LAN audio run is **not yet verified**. This is distinct from the cloud permission/signaling checks above. The final connection timeout allows 30 seconds for first-use permission interaction, and the setup page asks users to allow local network access. No browser security settings or certificate checks were disabled. See [Chrome's local-network access guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access).

The teacher page and setup instructions explicitly state that it must remain visible: background timer throttling can trigger the native one-second heartbeat cutoff. This limitation matters when presenting slides from another app and needs testing before classroom use.

## Remaining physical checks

- Real iPhone Safari and campus Wi-Fi, including local-network permissions and client isolation.
- Recorded original/reproduced sound through classroom speakers, accounting for microphone/recorder distances.
- Comparison against the existing direct WebRTC mode using the same hardware and network.
- Subjective speech clarity, feedback, interruption frequency, Mac audio-device selection and background-tab behavior.

The setup page labels the mode experimental, explains the Mac installation requirement and provides explicit return to Browser audio. Neither a 5 ms packet nor a small receiver queue establishes a 5 ms microphone-to-speaker result.

## Safari datagram correction — November 25, 2026

A physical iPhone test by the owner reported `undefined is not an object (evaluating 't.datagrams.writable.getWriter')` after the teacher's speaker test succeeded. The client reached this line after `transport.ready`, then failed because it assumed the legacy Chromium `writable` property. WebKit replaced that property with `createWritable()` ([WebKit change 302318](https://bugs.webkit.org/show_bug.cgi?id=302318)); the [current specification](https://www.w3.org/TR/webtransport/#datagram-duplex-stream) uses that method too.

The sender now prefers `createWritable()`, falls back to legacy `writable`, recognizes both buffering-property names, and checks for a usable writer before calling it. Two added regression tests exercise both API shapes with real WritableStreams and ensure an unavailable writer closes the transport with an actionable message. Together with two download-resume tests, all 31 JavaScript tests pass. This is a frontend update; the receiver binary is unchanged.

After the correction was published, the owner confirmed normal audio after refreshing the phone page and requesting to speak again: iPhone Safari to Mac Chrome with the native receiver, on the same Wi-Fi. The iOS version was not provided. This confirms audible playback in that setup; it is not an instrumented end-to-end latency measurement or a classroom acoustic test.

## Crackling correction — receiver 0.1.1, November 25, 2026

The owner then reported loud crackling during speech, a clean local test tone and silence after mute. An active report contained 1,810 received packets, zero sequence losses, 19 underruns and 52 queue resets, with a 20 ms target. Those counters identify repeated interruptions inside the receiver, without proving that every noise source is software-related.

The old 30 ms ceiling discarded the entire queue when a burst exceeded it. A deterministic 10-second simulation of 5 ms capture frames delivered in 32 ms batches reproduced 279 resets and 64 underruns. With receiver 0.1.1 the same simulation has zero resets and two initial underruns; 16 ms and 24 ms batches also avoid resets. This models batching and is not a replay of the owner's actual network trace.

Version 0.1.1 preserves queued audio, allows transient bursts up to a 50 ms cap and removes only the oldest excess samples if that cap is exceeded. The initial target remains 5 ms, with the existing adaptive maximum of 20 ms. One millisecond of blending at loss, starvation, recovery and trimming boundaries reduces hard sample jumps; uninterrupted samples are unchanged. In a deliberately worst-case constant-sample loss/recovery test, transitions stay below 1,000 PCM units per sample instead of a 20,000-unit hard edge. Explicit mute and the control deadline remain immediate. Seven Go tests pass with the race detector; 31 JavaScript tests and the universal build pass.

The receiver reports its version, queue trims and longest inter-packet arrival gap in Audio details. These diagnostics still do not measure total acoustic delay. The owner needs to quit the 0.1.0 receiver, open 0.1.1, create a class from the new paired tab, and retest. A physical-phone noise or latency improvement is not claimed before that check.

## Follow-up: uneven arrivals and worker sender

The owner's next report confirmed receiver 0.1.1 with zero resets but 12 underruns, 123 trims (522 ms removed), 1,178 received packets and a 98.18 ms maximum arrival gap. The owner described the remaining sound as stuttering rather than the previous rustling. These results do not establish a clean physical-device fix. The native counters cannot distinguish capture batching, page scheduling and network arrival jitter.

The frontend now sends worklet frames directly through a MessageChannel to a dedicated Worker owning WebTransport. The page only handles control and low-rate statistics. Explicitly unsupported Worker WebTransport uses the existing page path; network failures do not silently create a second connection. The student's report includes the sender path and separate callback, handoff, send-gap and write-completion maxima. Browser clock precision limits these measurements. This change does not increase the native playback target or claim to remove capture/OS/network buffering.

All 35 JavaScript tests pass, including real MessagePort transfer to the sender module running in a Node worker, bounded writes, stale-message rejection and stop behavior. A five-second Chromium localhost test used the production worker bundle, a synthetic oscillator, silent AudioContext sink and native receiver's silent sink. The sender reported 995 writes with zero drops; the receiver snapshot contained 994 packets, 237,600 played samples, two initial underruns, zero resets and zero trims. The maximum sender handoff was 1 ms and the receiver's longest arrival gap was 12.72 ms. Native mute cleared the queue and counters. Counts were sampled asynchronously, so the one-packet difference is not a loss estimate. This verifies the worker transport path with synthetic audio, not physical iPhone quality or total latency. No microphone access, audible output or recording was used.
