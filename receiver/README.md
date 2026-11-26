# MicTurn local receiver — experimental

Version 0.1.4 adds waveform-aligned catch-up when a network stall leaves persistently excessive queued audio. It shortens similar waveform sections with crossfades, keeps the existing small clock correction, and pauses catch-up if starvation returns soon afterward. Audio details reports catch-up events and the cumulative audio duration compressed. Constant large arrival bursts still require buffering; this cannot play packets before they arrive and is not a zero-latency claim. The 120 ms ceiling is unchanged. Quit the older receiver before opening this version. Refresh both browser pages and create a new class from the newly opened receiver tab. The teacher's Audio details shows the connected receiver version.

This Mac receiver lets students keep using the website while sending audio over local WebTransport datagrams instead of the browser WebRTC audio path. It is an alternative transport, not a zero-latency guarantee. Physical iPhone-to-classroom-speaker latency has not been measured for this release.

## Run

1. Select the classroom speakers in macOS Sound settings.
2. Unzip the download and open `Start Receiver.command`. Keep the terminal window open. The receiver opens the teacher website and pairs that tab automatically.
3. Create a class with **Local receiver (experimental)** selected. Use **Test speaker**, starting at low volume. Students join using the usual QR code.
4. Allow a speaking request. Both devices need the same reachable LAN. Campus client isolation or blocked UDP may prevent connection.
5. Stop with the website's Mute/End class buttons. Close the receiver window or press Control-C to exit. Restart after changing network or sound output device, and at least once per day.

The universal download contains Apple silicon and Intel builds. It is ad-hoc signed, **not Apple-notarized**. If macOS blocks it, inspect the source/download and use System Settings → Privacy & Security → Open Anyway. Do not turn off Gatekeeper or remove security settings globally.

The receiver requires no microphone permission: it opens only the selected audio output. Students still explicitly request microphone access in their browser. Their browsers need WebTransport and certificate-pin support (Safari 26.4+, current Chrome/Firefox); actual iPhone testing remains necessary. In-app browsers may differ. Allow local network access if the browser/OS asks.

If a local connection fails, the speaking turn stops. Select **Browser audio** on the teacher page, then ask the student to request again. This is deliberately not a silent transport switch that might leave two outputs playing.

## Pairing and network

The receiver listens on UDP 4444 on one private IPv4 interface, not the public cloud server. It generates a random ECDSA P-256 certificate valid for 24 hours and a 256-bit control key on each launch. Its pairing code includes the endpoint, SHA-256 certificate fingerprint and control key. Keep that code private to the teacher. The browser authenticates the certificate using `serverCertificateHashes`; TLS validation is not disabled. No certificate needs to be installed on students' phones.

The control key travels in the local WebTransport handshake, not through the hosted server. The URL fragment used to open the teacher page is removed immediately and is not sent in the HTTP request. It is saved only in that tab's session storage. The server sends each fresh speaking ticket only to the teacher and the approved student. Revocation clears the queue and closes the previous speaker's connection. A missing teacher heartbeat silences playback within one second, including when the teacher tab is suspended. Keep the teacher tab visible during use; background timer throttling can intentionally trigger this fail-closed behavior.

No audio is recorded or uploaded by the receiver. QUIC encrypts the local audio connection. The protocol does not rely on unauthenticated raw UDP. The receiver rejects wrong origins, invalid tickets, malformed frames and excessive frame rates. There is one controller and one active audio connection.

## Audio path and limits

The existing browser capture settings, high-pass filter, feedback guard and 3 ms limiter remain. An AudioWorklet emits 240 mono PCM16 samples at 48 kHz every 5 ms (with linear resampling if the browser context is 44.1 kHz). Its MessagePort goes directly to a dedicated Worker that owns the WebTransport connection, so audio messages do not wait for page rendering. Browsers without Worker WebTransport use the page sender; rejected network or permission requests are not silently retried. Packets carry a magic value, monotonically increasing sequence and rate. The sender discards worklet messages more than 30 ms old and permits at most three outstanding writes; datagram expiration is requested at 15 ms. The page fallback also checks audio-context age.

Student Audio details distinguishes the sender path, maximum worklet callback gap, worklet-to-sender handoff, send interval and write completion. Callback and handoff timestamps use the same device's wall clock and may be rounded by the browser. They exclude delays before the worklet receives the microphone data; write completion is not a network round-trip measurement. No audio content, network addresses or pairing credentials are included.

The native receiver starts with 5 ms queued audio and adds 5 ms after an underrun up to a 20 ms sample-count target. After starvation it also waits at least 5 ms from the first replacement packet before resuming, so a large arrival batch cannot bypass recovery simply by exceeding the sample target. It permits temporary bursts up to 120 ms of queued audio. That ceiling is not a fixed startup delay, but preserving a large burst does allow a larger temporary queue than the old 50 ms ceiling. When the ceiling is exceeded it removes only the oldest excess samples and keeps playback running. Each new speaker starts fresh. Late/reordered sequence numbers are discarded; up to two missing packets become silence, with one millisecond of blending at both boundaries. Starvation, recovery and queue trimming use the same blending to avoid hard waveform jumps. An arrival gap over 250 ms clears stale audio; explicit mute, revocation and heartbeat expiry still silence immediately. This is basic loss handling, not advanced speech reconstruction. These bounds cover application queues, **not** all browser, network, OS, device or acoustic latency. Capture timestamps are not synchronized across devices, so no complete one-way latency is inferred.

CoreAudio output uses malgo/miniaudio at 48 kHz with a requested 128-frame period and two periods. The OS/device may choose different buffering. This prototype uses a short mutex-protected Go audio queue; it does not claim hard real-time scheduling guarantees. Sound output is native, not another browser audio element. The cloud server still handles speaking permissions, so Internet is needed to manage the class even though local audio does not go through the cloud.

## Build and test

On macOS, install Go 1.25 or later and Xcode Command Line Tools. Dependencies are pinned in `go.mod` and `go.sum`.

```sh
go test -race ./...
sh build-mac.sh
```

The download is generated in `../public/downloads/`; build output and downloads are ignored by Git. The build includes third-party license notices and SHA-256 checksums. MicTurn itself remains source-visible with no open-source license grant added by this change.

Development flags: `--address 192.168.1.20`, `--port 4444`, `--origin http://127.0.0.1:3102`, `--no-open`. `--silent` consumes audio into a synthetic sink without accessing the speaker, for transport tests only. `--pair-file /tmp/pair.json` writes private pairing data for test harnesses; do not publish that file.
