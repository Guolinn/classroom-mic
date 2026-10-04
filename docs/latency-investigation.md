# Latency investigation — October 4, 2026

## Scope

The owner reports noticeable, roughly steady delay during a large-room trial of **MicTurn**, using **iPhone Safari → Mac Chrome → wired classroom speakers** (probably HDMI; the connector name was uncertain). This was not the professor's independent Agora implementation. The actual transport mode, device/browser versions and physical end-to-end latency are still unknown. These results cannot identify the cause of that classroom observation by themselves.

The relay scheduler and diagnostic UI were tested locally, then deployed on October 4 after the owner's approval. Direct WebRTC and microphone processing settings remain unchanged. No real microphones were recorded during these tests. Classroom end-to-end performance still needs measurement.

## Measured transport

`test/latency-probe.mjs` creates one temporary class, sends 600 synthetic 20 ms mono PCM packets at 48 kHz, and receives them on a separate host socket. Both clients run on the same machine and network. The class is ended afterward. This is a light functional measurement, not a load/capacity test.

| Path | Packets received | Median | 95th percentile | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Local Node server | 600 / 600 | 0.41 ms | 0.72 ms | 11.08 ms |
| Current public HTTPS/WebSocket service | 600 / 600 | 16.18 ms | 25.79 ms | 109.12 ms |

These values measure sender socket → server → receiver socket. They exclude microphone capture, audio processing, codec/framing, playback buffering, output hardware and sound propagation. They do not describe campus Wi-Fi. Raw reports are written to the ignored `test-results/latency-transport-*.json` files.

The initial public sample does not show sustained transport backlog, but one network/scheduling spike occurred. It is not evidence that the complete audio path has 16 ms latency. A later repeat during deployment received all 600 packets with a 40.84 ms median, 114.05 ms 95th percentile and 145.60 ms maximum. Network conditions were substantially more variable in that later window; the frontend scheduler does not affect this socket-only measurement.

## Previous production settings

- The limiter's lookahead is 3 ms; existing tests verify its sample delay and signal preservation.
- Relay capture groups 20 ms of audio into each frame.
- Relay playback starts with a 40 ms buffer and resets when queued playback is above 120 ms. A frame can extend scheduled playback beyond that threshold by one frame duration.
- Student upload and host relay forwarding currently allow up to 65,536 queued bytes before dropping new frames. At 48 kHz mono 16-bit PCM, that represents about 0.68 seconds of audio payload. This is an allowed queue threshold, **not an observed delay**.
- Relay frames contain a grant and sample rate but no capture timestamp. A frame delayed in transport cannot be identified as stale solely from its header.
- WebRTC requests a 20 ms receiver jitter-buffer target, which is a browser preference rather than a guarantee. It uses native audio-element playback.
- Echo cancellation and noise suppression remain enabled; optional voice isolation and low capture latency are preferences. Requested settings are not proof of applied settings.

## Diagnostic UI

Teacher and student pages now have a collapsed **Audio details** section. It only samples while open and copies a report on request. It reports the actual transport, selected-peer network round trip, recent receiver buffering/jitter/loss when supported, relay playback queue, and applied microphone settings.

Receiver buffer calculations use differences between successive statistics samples, not a call's lifetime average. Switching speakers, resetting counters and stale asynchronous samples do not produce misleading values. Missing metrics are marked unavailable. Web Audio output latency is shown only for relay playback; it does not describe the native WebRTC audio element. No single total-latency number is manufactured from these fields.

The copied report excludes audio, names, room codes, credentials, device IDs and network addresses. It is not uploaded automatically.

## Deployed relay change

- Start with a 20 ms playout safety margin instead of 40 ms. This removes 20 ms of deliberately added waiting when arrivals are stable; it does **not** promise a 20 ms total delay or prove any classroom improvement.
- After a buffer underrun or queue resync, restore the former 40 ms margin. A new speaker/connection resets the margin to 20 ms. Preserve continuity rather than forcing the shortest margin on an unstable connection.
- Bound scheduled PCM audio to 140 ms, including the incoming frame, and discard old scheduled sources on resync. This retains the former approximate queue allowance for 20 ms frames. This cap excludes already-buffered data in the network, WebSocket and output device.
- Do not accumulate incoming audio while the output AudioContext is suspended. Reject malformed or oversized-duration PCM frames before scheduling.
- Show buffer target, underrun count and queue-reset count in the collapsed diagnostics, so a reduction in buffering can be evaluated alongside interruptions.

A live browser comparison exposed excessive queue resets with a tighter 100 ms cap and a 60 ms adaptive margin. That candidate was rolled back and replaced with the former 40 ms recovery margin and 140 ms queue allowance. The regression fixture stores only relative arrival intervals for 600 synthetic frames, with no audio content or identifiers. Replaying it through the former scheduler and final scheduler produced 22 underruns and 20 resets in each. This demonstrates parity on one recorded burst pattern, not glitch-free audio under all conditions.

Opus packet duration, direct receiver buffering, echo cancellation, noise suppression and the 3 ms limiter were not changed. A local direct-mode A/B experiment could not establish ICE connectivity (checks received no responses), so it produced **no valid latency comparison**. No parameter change from that experiment was adopted.

## Verification and limitations

- All 22 local tests passed, including six diagnostics regressions and four adaptive scheduling tests; the production build passed. Scheduling tests cover stable arrivals, modest jitter, late arrivals, burst recovery, suspended output, reset on speaker change and frame validation. These are deterministic functional checks, not a campus-network benchmark.
- Local browser checks verify the diagnostic section starts collapsed and can be opened. A temporary silent student was approved through the real room controls, transmitted relay PCM, and showed the relay connection, playback queue and browser output estimate. Teacher mute stopped the probe and returned diagnostics to Inactive; ending the class disconnected it. Temporary tabs and classes were closed afterward.
- After the scheduler change, a generated tone traversed the actual input-processing graph, 20 ms worklet framing, local server and receiver. It sent 1,792 frames (35.84 seconds of audio). A mid-run snapshot showed a 36 ms scheduled queue, 20 ms target, zero underruns and zero resets; the browser reported a separate 24 ms output estimate. Do not add these values to manufacture an end-to-end measurement. Output was muted. Mute released both streams and class end closed the test context/socket.
- A synthetic browser loopback experiment produced inconsistent signal timestamps and did not establish a reliable direct-mode measurement. Those readings were rejected and are not used in the results above; the temporary experiment was removed.
- Physical microphone-to-loudspeaker latency has **not** been measured. The reported phone/browser combination and actual classroom speaker path still need a controlled comparison.
- Publication preserved the server process and previous frontend entry for rollback. All seven public build files matched their local SHA-256 checksums. Public HTTPS, room creation, join, WebSocket upgrade, approval, relay, mute and class end checks passed. Existing tabs retain their loaded code until refreshed.

## Next comparison

1. Reload both devices to use the October 4 release. During a speaking turn, check whether **Audio details** reports Direct WebRTC or Server relay.
2. Compare computer built-in/wired output with the actual classroom output, at low volume, using the same phone and network. Record the output method, browser and whether delay stays steady or grows.
3. Read/copy the diagnostics from both devices during a speaking turn. A receiver buffer or network round-trip is one component, not the whole acoustic path.
4. For a real end-to-end acoustic test, record both the original sharp sound near the phone microphone and its loudspeaker reproduction with a single external recorder at a documented position. Their waveform separation includes propagation to the recorder; account for the difference in distances when estimating electronic latency. Obtain consent if any speech is captured.
5. If the relay is responsible, compare the new target/underrun counts and evaluate timestamped stale-frame rejection and tighter backpressure if transport backlog is observed. If direct playback is responsible, examine browser jitter-buffer statistics and applied capture settings before reducing processing. Preserve echo/feedback protection while comparing settings.

References: [W3C WebRTC receiver buffering](https://www.w3.org/TR/webrtc/), [W3C WebRTC statistics](https://www.w3.org/TR/webrtc-stats/), [AudioContext output latency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency).
