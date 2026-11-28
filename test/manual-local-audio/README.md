# Development-only audio checks

These pages were used in the native-output investigation. They are not production entry points, and `npm run build` does not publish them.

- `app.html` loads the regular classroom UI from an isolated candidate bundle while retaining a specified `/host/NNNNNN` or `/join/NNNNNN` route. It uses the normal class permissions and microphone prompts.
- `index.html` is a thirty-second live-microphone check. It retains numerical measurements in the browser, not recordings.
- `trace.html` and `inspect.html` send generated speech using `synthetic-playback.js`. They expect a separately supplied synthetic `voice.wav` two levels above the page. The teacher branches require explicitly instrumented local receiver versions; those recording/debug binaries are not distributed. Do not use them with human microphone input.
- `compare.html` is the earlier exploratory comparison harness. It is retained for investigation history, not used for release validation. Prefer the tested cancellation and cleanup helper in `synthetic-playback.js` for new checks.

Pairing keys and student tickets belong in local URL fragments only. Do not commit generated URLs, private pairing files, audio recordings or measurement captures. Tests in `test/synthetic-playback.test.mjs` cover stopping and cancelling the synthetic signal when startup fails or the connection ends.
