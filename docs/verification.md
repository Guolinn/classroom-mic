# Verification

Repository: [Guolinn/classroom-mic](https://github.com/Guolinn/classroom-mic).

## Recorded checks

The following results were recorded on October 2, 2026:

- Eight local tests passed: four server tests and four audio-processing tests.
- Seven browser scenarios passed against the public deployment, using generated microphone audio and separate browser contexts.
- Terms and Privacy pages, contact links, separate-tab navigation, and mobile overflow were checked during the legal-page update.
- The subsequent two-line footer update built successfully and the server health check passed. Its fresh browser visual check was unavailable because the browser tool could not complete its security check.

These are automated or browser checks, not measurements of a physical classroom. Physical iPhone and Android devices, campus Wi-Fi, BRCS 1030's sound system, acoustic feedback, and end-to-end acoustic latency have not been verified.

## Local checks

```sh
npm ci
npm test
npm run build
```

Server tests cover room creation, origin validation, teacher privileges, speaker permissions, audio frame authorization, disconnects, and reconnection. Audio tests cover quiet-signal preservation, peak limiting, recovery after overload, and 20 ms PCM framing at different sample rates.

GitHub Actions runs the unit tests and build on pushes and pull requests. It does not deploy the website or start real classroom sessions.

## Browser scenarios

Install the browser once:

```sh
npx playwright install chromium
```

Run `npm run dev` in one terminal, then:

```sh
npm run test:browser
```

The scenarios use generated audio and check microphone settings, filter response, processed WebRTC audio, PCM relay audio, track cleanup, teacher mute, speaker switching, pause/resume, QR presentation, refresh, reconnection, and mobile overflow. They create and end temporary classes. Generated screenshots, audio, and reports stay in the ignored `test-results/` directory.

To run against a deployment you own, set `TEST_BASE_URL` to its HTTPS origin. The browser scenarios currently assume classroom creation does not require a password.

An additional HTTP/WebSocket smoke check is available as `deploy/smoke-https.mjs`. Set `TEST_ORIGIN` to your deployment and run it with Node.js. It also creates a temporary class; use it only on a deployment you control.

## First classroom use

Connect the teacher computer to the room sound system, preferably using HDMI or USB-C, and use `Test speaker`. Start with low volume. Try one speaking turn from a phone farther back in the room and confirm that teacher mute stops playback. Keep the student page in the foreground and the phone near the mouth. A wired speaker connection avoids adding a separate wireless audio hop.

A short on-site check can reveal device or room issues that generated browser audio cannot detect. It is not a prerequisite for storing the source on GitHub.
