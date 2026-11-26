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

## Remaining physical checks

- Real iPhone Safari and campus Wi-Fi, including local-network permissions and client isolation.
- Recorded original/reproduced sound through classroom speakers, accounting for microphone/recorder distances.
- Comparison against the existing direct WebRTC mode using the same hardware and network.
- Subjective speech clarity, feedback, interruption frequency, Mac audio-device selection and background-tab behavior.

The setup page labels the mode experimental, explains the Mac installation requirement and provides explicit return to Browser audio. Neither a 5 ms packet nor a small receiver queue establishes a 5 ms microphone-to-speaker result.
