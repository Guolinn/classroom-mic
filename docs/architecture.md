# Architecture

Repository: [Guolinn/classroom-mic](https://github.com/Guolinn/classroom-mic).

## Components

- React and Vite render the teacher, student, and policy pages.
- One Node.js process serves the production files, creates rooms, and handles WebSocket signaling and fallback audio.
- WebRTC normally sends the approved student's processed microphone audio directly to the teacher.
- AudioWorklets process microphone samples and the PCM fallback. The teacher uses a native audio element for WebRTC playback; retain that playback path when changing the audio code.
- A reverse proxy supplies HTTPS. The current deployment uses Caddy.

## Audio flow

```text
Phone microphone -> browser capture processing -> high-pass / feedback cuts / limiter
                                              -> WebRTC -> teacher audio output
                                              -> WSS relay -> teacher PCM playback
Teacher computer -> classroom sound system
```

Only the approved student's microphone sends audio. Other students do not receive a monitoring stream. The server controls the active speaker and permission generation for fallback frames; connected clients stop audio when permissions change.

## Audio and session behavior

- WebRTC sends audio from the approved student to the teacher. No student receives classroom audio.
- Microphone capture requests browser echo cancellation and noise suppression, optional voice isolation, mono audio, a preferred 48 kHz sample rate, and a 10 ms capture-latency preference. Automatic gain control is disabled where supported so pauses do not cause automatic amplification of background sound. These are preferences, not guarantees: the browser can ignore unsupported settings, and the Chromium test device did not apply voice isolation.
- Both audio paths use the same 80 Hz high-pass filter and a peak limiter with 3 ms lookahead, a 0.89 sample ceiling, and 60 ms gain recovery. The limiter has no makeup gain or noise gate: ordinary and quiet speech are not automatically amplified or cut off. This reduces rumble and limits signal peaks; it cannot repair sound already clipped by the microphone or guarantee feedback cancellation.
- Between the high-pass filter and limiter, a conservative feedback guard watches for up to two persistent, dominant tones between 180 Hz and 5 kHz. A tone must exceed -45 dB at its spectral peak, account for at least 86% of the analysed band energy, and remain stable for at least 600 ms. Each confirmed frequency receives a narrow 9 dB cut with Q=18 and a smooth gain transition. Analysis runs on a silent branch and adds no audio buffer. Cuts reset when the microphone is released. Harmonic voice, quiet audio, changing pitches, and broadband noise are left alone in the synthetic tests; a sustained musical tone or whistle can still be attenuated. This is a speech-oriented heuristic, not general echo cancellation or a feedback guarantee.
- Speaker volume starts at 50%. Raw capture and processed output are disabled while waiting for approval; both stop on cancellation, mute, speaker changes, disconnection, or audio-processing failure. The phone never plays its own microphone signal.
- Direct playback requests a 20 ms receiver jitter-buffer target where supported. The browser may select a different delay to cope with the network. Obsolete track callbacks are rejected after a connection or mode change, so they cannot recreate native playback alongside the PCM relay.
- If direct connectivity fails or cannot be established within 6.5 seconds, a same-origin WebSocket relays audio through the application server.
- The relay uses mono PCM16 with 20 ms frames. The scheduler starts with a 20 ms playback margin, restores the former 40 ms margin after an underrun or queue resync, and resets it for each speaker/connection. If queued audio including the next frame would exceed 140 ms, it discards scheduled sources and restarts with current input. Suspended output does not accumulate new audio. Bursts can therefore cause short skips. At 48 kHz, one active relay uses about 0.8 Mbps in each direction. These settings bound only the application's scheduled queue, not network or device buffering or end-to-end latency. The October 4 release reduces the initial margin while retaining the former jitter tolerance and roughly 140 ms queue allowance for 20 ms frames; see [latency investigation](latency-investigation.md).
- The server checks the active speaker and permission generation for each audio frame. Mute, speaker changes, and disconnection clear pending playback.
- Classroom state is process-local. Use one process, not multiple replicas behind a load balancer. Horizontal scaling requires shared room state and cross-process routing.
- Classes expire after 12 hours, or after the teacher has been offline for five minutes. Offline students are removed after ten minutes. Reloading the original teacher tab restores its session; closing the tab may discard its browser-scoped credential.
- Classroom session tokens stay out of URLs and student QR codes. Local receiver pairing uses a teacher-only URL fragment that is immediately removed, and temporary keys in encrypted local WebTransport handshakes. Audio is not written to files or a database.
- `ICE_SERVERS_JSON` can provide private TURN endpoints if needed. This value is delivered to class participants; use browser-safe, short-lived credentials and never a provider management API key.


## Optional local receiver

The November 25 experimental mode replaces only the media path: the server still owns classroom permissions. A paired native Mac program accepts encrypted WebTransport control and audio sessions. The teacher's 256-bit control key stays in the receiver and their tab. Per-turn tickets, the LAN endpoint and certificate pin pass through the classroom server only to the teacher and active student. Other students do not receive the ticket. Old browser clients must reload before participating in this mode.

The native receiver accepts one controller and one approved sender. Muting or switching replaces the ticket, closes the old session and clears its queue. The server rejects attempts to change a local speaking turn to relay mode; failure ends the turn instead. Browser mode is an explicit teacher selection and requires a new request. If control heartbeats stop, the native render callback produces silence within one second. Keeping the host page visible is necessary; throttled background timers may trigger this behavior.

The sender uses the existing microphone protection graph and a separate 5 ms PCM worklet. WebTransport datagrams avoid retransmitting late audio; application backpressure and packet age checks discard stale sender work. The receiver uses a small bounded queue, ignores old sequence numbers, inserts silence for short losses, and resets on long gaps. Capture and native output latency remain device-dependent and are not derived from queue sizes. See [receiver documentation](../receiver/README.md) for packet format, buffering, TLS pinning, limitations and build instructions.

## Boundaries

A class code permits joining; it does not establish a student's identity. Teacher and student session credentials authorize their respective controls. Run a single server process: room state is in memory and is lost on restart. A new teacher connection replaces the previous connection for the same session, so a separate TA or iPad controller is not implemented.

No audio recording, transcription, analytics service, or database is implemented. The relay server can access the audio it relays. Browser echo cancellation does not have a direct reference to the separate teacher computer's loudspeaker output; room feedback still depends on placement, levels, and the sound system.

The browser preferences follow the [WebRTC jitter-buffer specification](https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget) and [voice-isolation constraint](https://w3c.github.io/mediacapture-extensions/#voiceisolation-constraint). Voice isolation does not replace echo cancellation. [Shure's feedback guidance](https://www.shure.com/en-US/insights/how-to-control-feedback-in-a-sound-system) explains why frequency cuts still need appropriate speaker levels and microphone placement.
