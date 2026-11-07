# AGENTS.md

For anyone working in this repository, people and AI agents alike. What the tool does and how the code is laid out
are in [README.md](README.md); the technical reasons behind it, and what was tested and dropped, are in
[docs/decisions.md](docs/decisions.md). 1ms.dog's operations notes are in the private repository 1ms-shell.

## What this is

Reach Check answers "can other people reach my website, NAS or game server, and if not, where does it
stop?". It has three parts:

- **The page** (`src/`, built into `public/`): runs in the visitor's browser. It calls Globalping's API for the
  18-region outside check, times two requests from the browser itself, and asks our server for the close-up view.
- **The Worker** (`src/worker.js`): only runs for shared result links (`/r/<code>`), to give their preview a title.
  Everything else is a static file.
- **The server** (`server/`, Go): `1ms-reach`, one program on one machine, listening on 2096/tcp. It reads a
  service's greeting or TLS certificate chain, and checks UDP ports. The page calls it at the `API` constant in
  `src/app.js`; the server answers browsers only from the origins in `allowedOrigin` (`server/main.go`). Self-hosted,
  change both to your own addresses.

## Run it locally

```bash
npm ci
npm run build      # src/ → public/; commit public/ with your change
npm run dev        # http://localhost:8787, static files with the production headers
npx wrangler dev   # the same with the Worker, to open /r/ links
```

The local page still calls the server named by `API` in `src/app.js`: the CSP (`connect-src 'self' https:`)
doesn't allow a plain-HTTP local one. To work on the server itself:

```bash
cd server
go vet ./... && go test ./...
go run . -plain -addr 127.0.0.1:12096          # then: curl "http://127.0.0.1:12096/v1/probe?host=github.com&port=22"
```

The limits apply locally too (10 checks and 5 addresses an hour per visitor): restart the program to reset them. A
machine behind a proxy with fake-ip DNS gets `"k":"private"` for every name (198.18.0.0/15 is refused, as it should
be); test real targets from a machine without one.

## Test by what you changed

| You changed | Run |
|---|---|
| strings (`src/i18n/*.mjs`) | `npm test` (every language has every key, with the same placeholders and marks). Read the sentence in Chinese and Russian at 375 px wide |
| the page (`src/app.js`, `page.html`, `style.css`) | `npm run build && npm test` (the built script must parse). Then open the page: one TCP check (say `github.com`, port 22), one UDP check (`cloudflare-quic.com`, 443), and the phone width (375 px) |
| result links (`src/code.mjs`, `src/worker.js`) | `npm test`, then open a `/r/` link under `npx wrangler dev` and check its title |
| the server (`server/`) | `go vet ./... && go test ./...` in `server/`; after deploying, the checks under "Verify" below |
| the build (`scripts/build.mjs`) | `npm test` (`public/ is up to date`) |

`npm test` is what the deploy runs; it must pass.

## Deploy

- **The site**: pushing `main` deploys it (Cloudflare Workers Builds runs `npm ci && npm test`, then
  `npx wrangler deploy`), in about half a minute. To host it yourself: `npx wrangler deploy`, then bind a domain to the
  Worker in the Cloudflare dashboard.
- **The server**: by hand, as below. It is not deployed by a push.

## The server 1ms-reach, from nothing

It needs a Linux machine with systemd (for `LoadCredential=` and `IPAddressDeny=`, which needs cgroup v2), a public
IPv4 and ideally IPv6, and a domain (`<api-domain>` below) pointing at it with A and AAAA records. There must be no proxy in front of it:
visitors connect directly, so the program's own limits are what stop it being used to scan others.

1. **A user and a directory**
   ```bash
   useradd --system --no-create-home --shell /usr/sbin/nologin <user>
   mkdir -p /opt/<app>
   ```
2. **Build** (anywhere with Go; the machine itself needs no compiler)
   ```bash
   cd server
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o 1ms-reach .
   ```
   Upload it to `/opt/<app>/1ms-reach`, owned by root, mode 755.
3. **Certificate** for `<api-domain>`, for example with certbot, so it lands in
   `/etc/letsencrypt/live/<api-domain>/`. Renewal must restart the service (a certbot deploy hook:
   `systemctl restart 1ms-reach`).
4. **The unit**: copy [server/1ms-reach.service](server/1ms-reach.service) to `/etc/systemd/system/`. It is written
   for one particular machine; change:
   - `User=`, `Group=` and the binary's path in `ExecStart=`;
   - the certificate paths in `LoadCredential=`;
   - `-self` (the machine's public IPv4 when it sits behind NAT and isn't on an interface);
   - the machine's own addresses at the end of `IPAddressDeny=`.

   Then:
   ```bash
   systemctl daemon-reload
   systemctl enable --now 1ms-reach
   ```
5. **Firewall**: allow 2096/tcp in, over IPv4 and IPv6, in the cloud provider's firewall and on the host. The server
   listens on no UDP port: it only sends UDP.
6. **Upgrade later**: upload the new binary over the old one, then `systemctl restart 1ms-reach`.

### Verify

On the machine:

```bash
systemctl is-active 1ms-reach
ss -tlnp | grep ':2096'
systemctl show 1ms-reach -p MemoryCurrent -p IPAddressDeny     # about 15 MB; the deny list is in force
journalctl -u 1ms-reach -n 20                                  # empty: it logs nothing but fatal errors
```

From another machine (`U=https://<api-domain>:2096`):

```bash
curl -4 "$U/healthz"; curl -6 "$U/healthz"                     # ok, ok: a valid certificate on both
curl -4 -H 'Origin: https://<page-domain>' -D - "$U/v1/probe?host=github.com&port=22&ipv=4"
                                                               # "k":"banner","svc":"ssh", and the CORS header
curl -4 "$U/v1/probe?host=cloudflare-quic.com&port=443&mode=udp&ipv=4"   # "k":"answered","via":"quic"
```

**It must never connect to a private or its own address.** Each of these must answer `"k":"private"` with no `"tcp"`
field (no connection was made):

```bash
for h in 169.254.169.254 fd00:ec2::254 127.0.0.1 10.0.0.1 localtest.me <the machine's own public IP>; do
  curl -4 -s "$U/v1/probe?host=$h&port=80"; echo
done
```

`169.254.169.254` and `fd00:ec2::254` are the cloud's metadata service: reaching them would be a security hole.
Bad input must get 400 (`host=1.2.3.0/24&port=22`, `host=a.com&port=1-1000`, `host=localhost&port=22`). The limits:
from one IP, the 6th different target in an hour gets 429 with `"which":"targets"`, and the 11th check 429 with
`"which":"visitor"`.

## Rules of the road

- Pushing `main` deploys the site (when it is connected to Workers Builds): push only what is ready to go live.
- `public/` is built output, committed with the source change that made it (`npm run build`).
- No secrets and no personal email in this public repository. Where a particular deployment runs (domains,
  directories, ports, accounts) belongs with that deployment's own notes, not here; use placeholders.
- Commit messages in English. User-facing strings exist in 10 languages; English (`src/i18n/en.mjs`) is the
  reference.
- When something is decided, or tried and dropped, write it in [docs/decisions.md](docs/decisions.md) the same day.
