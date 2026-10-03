# MicTurn

Use a phone as a classroom microphone. The teacher opens the website on a computer connected to the room speakers. Students scan a QR code, request to speak, and transmit audio when the teacher allows it.

- Website: [classroom-mic.beringtech.com](https://classroom-mic.beringtech.com)
- GitHub: [Guolinn/classroom-mic](https://github.com/Guolinn/classroom-mic)
- Contact: [guolinn@student.ubc.ca](mailto:guolinn@student.ubc.ca)

Made by Guolin in UBC. This is an independent personal project, not an official UBC service.

## Use

1. Connect the teacher computer to the classroom sound system. HDMI or USB-C is preferable where available.
2. Open the website, choose **Teacher**, enter a class name, and select **Create class**.
3. Use **Test speaker** and start at a low volume. Display the QR code or share the class code.
4. Students scan the code, enter a name, and select **Request to speak**. Their browser asks for microphone permission.
5. The teacher selects **Allow**. Only one student microphone is active at a time. The teacher can mute, switch speakers, pause requests, or end the class.

The phone sends audio through the network; it does not need to pair with the computer over Bluetooth. Keep the phone page open and the screen unlocked during a speaking turn.

## Status

The website is deployed. Server and audio unit tests and browser scenarios have passed; actual phones, campus Wi-Fi, classroom feedback, and end-to-end acoustic latency have not been verified. See [verification](docs/verification.md) for the scope of each check.

GitHub stores the source and runs build checks. A push does not automatically deploy or restart the live website.

## Run locally

Use Node.js 24 (also specified in `.nvmrc`). The declared minimum is Node.js 22.13.

```sh
git clone https://github.com/Guolinn/classroom-mic.git
cd classroom-mic
npm ci
npm run dev
```

The repository is public and can be viewed or cloned without signing in. Open `http://localhost:3000` and use separate browser tabs for teacher and student. Physical phones require HTTPS; an ordinary HTTP LAN address will not grant microphone access.

For a local production build:

```sh
npm run build
npm start
```

The application does not read `.env` automatically. See [deployment](docs/deployment.md) for environment loading, HTTPS, Docker Compose, and the current server's systemd setup.

## Checks

```sh
npm test
npm run build
```

For browser scenarios, start the app separately and run:

```sh
npx playwright install chromium
npm run test:browser
```

See [verification](docs/verification.md) for prerequisites and what the checks cover.

## How it works

React provides the interface and one Node.js process manages rooms and permissions. WebRTC carries microphone audio to the teacher; if a direct connection fails, a same-origin WebSocket relays audio through the server. Both paths use a high-pass filter, up to two narrow cuts for persistent feedback tones, and a peak limiter. Browser noise suppression, echo cancellation, and optional voice isolation are requested where supported. Playback favors short buffers and discards accumulated relay audio instead of replaying a long backlog.

Rooms exist in memory and disappear when the server restarts. No audio recording, transcription, analytics tracker, or database is implemented. Relayed audio is encrypted in transit but can be accessed by the relay server. Room acoustics and speaker placement still affect feedback; software processing does not guarantee its removal.

Read the [architecture](docs/architecture.md), [Terms of Service](https://classroom-mic.beringtech.com/terms), and [Privacy Policy](https://classroom-mic.beringtech.com/privacy). Both policy pages include the contact email and a link to [Guolinn's GitHub profile](https://github.com/Guolinn).

## Project files

| Path | Contents |
| --- | --- |
| `src/` | Teacher and student interface, browser audio, and English policy pages. |
| `public/` | AudioWorklet processors. |
| `server/` | HTTP API, room permissions, signaling, and audio relay. |
| `test/` | Server, audio, and browser checks. |
| `deploy/` | Current-host service definition, activation script, and smoke check. |
| `docs/` | Deployment, architecture, and verification notes. |
| `.github/workflows/` | Automatic unit tests and production build. |

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [SECURITY.md](SECURITY.md) for private vulnerability reporting. Real environment files, private keys, generated builds, and test output are excluded from Git.

## License

The source is publicly visible but has not been released under an open-source license. Dependency licenses remain applicable to their respective packages.
