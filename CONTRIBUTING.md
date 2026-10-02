# Contributing

Repository: [Guolinn/classroom-mic](https://github.com/Guolinn/classroom-mic).

This is currently a private project. Collaborators can create a branch and submit a pull request. Keep changes focused and explain the user-visible behavior in the pull request description.

Use Node.js 24, install dependencies with `npm ci`, and start development with `npm run dev`. Run `npm test` and `npm run build` before submitting code changes. For changes to microphone permissions, audio transport, or room controls, also run the existing browser scenarios described in [verification](docs/verification.md).

Keep the interface minimal and in English. Prefer functional labels; avoid decorative cards, promotional copy, or extra branding. Preserve the separate teacher and student controls and one active student microphone per class.

Do not commit credentials, private keys, real classroom session data, recordings, or generated test output. Use `.env.example` for placeholders. If a change affects data collection, providers, retention, or recording, update `src/legal.jsx` and the documentation with the actual behavior.

Report bugs with the browser and device, the steps to reproduce, and whether the teacher used a wired or wireless speaker connection. Do not include live class codes or session tokens. Report security issues privately using [SECURITY.md](SECURITY.md).
