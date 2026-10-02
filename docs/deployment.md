# Deployment

Repository: [Guolinn/classroom-mic](https://github.com/Guolinn/classroom-mic). Current website: [classroom-mic.beringtech.com](https://classroom-mic.beringtech.com).

Use Node.js 24 and one application process. Smartphones need HTTPS for microphone access; a plain HTTP LAN address is not enough. DNS points the domain to the server, and the firewall must also permit HTTPS on TCP 443. WebRTC may use a direct network path; its WSS fallback shares the website's HTTPS entry point.

## Existing production host

The current deployment uses the host's Caddy service to terminate TLS and proxy requests to `127.0.0.1:3000`. `classroom-mic.service` runs Node.js. Do not start the Docker Compose Caddy service on this host because those ports already belong to the existing proxy.

Build before copying a release:

```sh
npm ci
npm run build
```

Copy `dist/`, `server/`, `deploy/`, `package.json`, and `package-lock.json` into a new directory under `/opt/classroom-mic/releases/`. Install the production dependencies there with `npm ci --omit=dev`. The `/opt/classroom-mic/current` symlink points to the active release.

The systemd service reads `/etc/classroom-mic.env`:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=https://classroom-mic.beringtech.com
TRUST_PROXY=1
MAX_ROOMS=100
MAX_STUDENTS=300
```

`deploy/classroom-mic.service` assumes the service account is `ubuntu`, Node.js is at `/usr/local/bin/node`, and the release paths above exist. `deploy/activate-release.sh` is specific to this production host and domain. Inspect and adapt these files before using them on another machine.

On the current host, activate a prepared release with:

```sh
bash /opt/classroom-mic/releases/RELEASE_NAME/deploy/activate-release.sh /opt/classroom-mic/releases/RELEASE_NAME
```

Replace `RELEASE_NAME` with the actual directory name. The script switches the release, restarts the service, checks health, and attempts rollback if activation fails. Restarting ends existing classes; deploy between sessions. To roll back later, restore the previous `current` symlink and restart `classroom-mic`.

Verify service health:

```sh
sudo systemctl status classroom-mic --no-pager
curl --fail https://classroom-mic.beringtech.com/healthz
```

GitHub pushes do not deploy this service. The repository's CI only checks tests and builds.

## New server using Docker Compose

Use this option on a host without another service occupying ports 80 and 443. Point your domain's DNS at the host and allow TCP 80 and 443.

```sh
cp .env.example .env
```

Set `DOMAIN=mic.example.com` in `.env`, replacing it with your real domain. Then run:

```sh
docker compose up -d --build
docker compose logs --tail=100 app caddy
```

Caddy obtains and renews the certificate. Compose exposes the application only to its internal network and persists Caddy's certificate data in named volumes. The optional UDP 443 mapping supports HTTP/3; it is not a TURN server.

## Another reverse proxy

Build the frontend, run `npm start` with the production environment, and proxy HTTPS and WebSocket upgrades to the application. Preserve the Host header and use a read timeout of at least 60 seconds. Bind Node.js to loopback when the proxy is on the same host.

The application does not load `.env` automatically. Docker Compose and the supplied systemd unit load configuration for their respective deployments. For a direct local production run, set environment variables in the shell or use Node's environment-file option:

```sh
NODE_ENV=production node --env-file=.env server/index.mjs
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Use `production` to serve the built frontend. |
| `HOST`, `PORT` | Listening address and port; use `127.0.0.1:3000` behind a host proxy. |
| `PUBLIC_URL` | The exact public origin used to validate requests. |
| `HOST_PASSWORD` | Optional password required to create classes. |
| `TRUST_PROXY` | Set to `1` only when a trusted proxy is the exclusive route to Node.js and controls forwarded headers. |
| `MAX_ROOMS` | Room limit; defaults to 100. |
| `MAX_STUDENTS` | Participant limit per room; defaults to 300. |
| `ROOM_TTL_MS` | Room lifetime; defaults to 12 hours. |
| `ICE_SERVERS_JSON` | Optional STUN/TURN configuration sent to participants. |
| `DOMAIN` | Public hostname used by Docker Compose and Caddy. |

Keep real environment files and credentials outside Git. `ICE_SERVERS_JSON` is visible to participants; supply browser-safe, short-lived TURN credentials rather than provider API keys. No TURN server is bundled or currently installed on the production host.

## Policies and hosting

The bundled Terms and Privacy Policy describe the existing service: an independent project by Guolin, AWS hosting in Oregon, Cloudflare STUN, and temporary in-memory room state. A different operator or hosting setup must update `src/legal.jsx` to describe its own service accurately. The current policies are not an institutional or legal approval.
