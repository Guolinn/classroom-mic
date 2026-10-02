# Security

Send suspected security issues to [guolinn@student.ubc.ca](mailto:guolinn@student.ubc.ca). Include the affected behavior, reproduction steps using a class you control, and the browser or deployment version where possible. Do not include passwords, private keys, other people's session tokens, or recordings.

Please report privately before posting details in an issue. This personal project has no guaranteed response time or bug bounty program.

Only the current `main` branch is maintained. Deployment fixes require updating the running server; publishing a GitHub commit does not automatically deploy it.

Production requires HTTPS and a reverse proxy with WebSocket support. Protect the application port from direct public access when enabling `TRUST_PROXY`. Class codes allow joining and are not identity verification; the teacher approves each speaking turn. Server-relayed audio is protected in transit, but is not end-to-end encrypted against the server operator.

See [deployment](docs/deployment.md) and the live [Privacy Policy](https://classroom-mic.beringtech.com/privacy) for hosting and data-processing details.
