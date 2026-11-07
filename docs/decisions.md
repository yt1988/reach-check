# Decisions

Why Reach Check is built the way it is technically, and what was tested and dropped. The code comments say what the
code does; this says why, so that nobody re-runs an experiment that already failed.

## The server (server/)

- **Depth, not breadth.** One machine can't tell what another country sees; Globalping's 18 regions do that. The
  server adds what neither the browser nor Globalping can: what a non-web service says on its port, the full TLS
  chain and why it isn't trusted, and UDP. Ping, traceroute and MTR stay with Globalping: run from the region that
  failed, they say more than one fixed point.
- **Globalping is still called from the browser, not through the server.** Each visitor spends their own allowance
  (250 region checks an hour per IP). Proxied, every visitor would share the server's single allowance.
- **QUIC: a real handshake, not version negotiation.** The first version sent a packet with a reserved QUIC version,
  which every server should answer with its version list (RFC 9000 §6). Google does; Cloudflare doesn't, so
  `cloudflare-quic.com` looked silent. It now does a real QUIC handshake (quic-go, ALPN h3, the name as SNI) and closes
  it. Any QUIC answer, a refused handshake included, counts as "answered".
- **ICMP "port unreachable" is not always the host's word.** Cloudflare's edge answers non-QUIC UDP on 443 (a DNS
  query, a Steam ping) with port unreachable, while QUIC on the same port works. So QUIC goes first, and the first real
  answer wins; "closed" is only reported when nothing answered before the ICMP came.
- **UDP "silent" proves nothing**, and the page says so. WireGuard and most games answer only a message they
  recognise. The hellos sent (QUIC, DNS, Minecraft Bedrock's unconnected ping, Steam's A2S_INFO) cover the services
  that do answer strangers.
- **Only the handshake, never a payload.** TCP: read what the service says first; if it waits, offer a TLS
  ClientHello and read what comes back. No HTTP request, no login attempt.
- **Names are resolved at public resolvers** (1.1.1.1, 8.8.8.8, 9.9.9.9), not the machine's own: a cloud network's
  resolver answers internal names. The address checked is the one connected to, so a name can't change its answer in
  between (DNS rebinding).
- **Never a private, reserved or own address**, checked twice: in the program (`addrKind` in server/addr.go) and by
  the kernel (`IPAddressDeny=` in the unit). The cloud metadata addresses 169.254.169.254 and fd00:ec2::254 fall in
  these ranges. A fake-ip range (198.18.0.0/15) is refused too.
- **Limits** (server/limits.go): 10 checks and 5 different targets an hour per visitor (an IPv6 visitor by their /64);
  30 connections an hour to one address, whoever asks; 60 a minute and 1000 an hour for the whole site; 16 at once.
  An answer is reused for 5 minutes, so repeats don't reach the target again. The visitor's 10 roughly match what
  Globalping lets them run in an hour (13 checks of 18 regions).
- **Nothing is kept.** No access log (`StandardOutput=null`, `LogLevelMax=err`). Visitors are counted by a keyed hash
  of their IP, with a key made at start that never leaves memory.
- **No proxy in front.** Visitors connect directly (a CDN proxy would hide their IPs and the limits would count the
  proxy). The default port, 2096, is one Cloudflare also proxies, should a deployment want that anyway.

## The page

- **A target that resolves to a private address.** Globalping refuses such targets with "Private IP
  ranges are not allowed" and no address, so the page used to say only "unreachable from outside". It now treats that
  message as its own outcome and takes the address from our server, which resolves the name but doesn't connect.
- **UDP checks have no share link or invite.** The result is the server's alone: there are no regions for the card,
  the Worker titles only TCP verdicts, and a friend's browser can't add a UDP view.
- **The server's answer travels in a result link** (field `s`); links made before it have none, and then the row isn't
  drawn.
- **Plurals**: sentences with a number have `key_one` (and `_few` in Russian), chosen with
  `Intl.PluralRules`, in the page and in the Worker's preview titles. Chinese, Japanese and Korean repeat the sentence.
- **Region names** come from the browser (`Intl.DisplayNames`), except Taiwan's, which is a fixed table
  ("Taiwan, China" / 中国台湾 …) kept in line by a test.
- **The share card never cuts text short**: the title shrinks, then wraps to two lines; the target sits
  right under it; region names are short ("Los Angeles, US"); fewer columns when a name doesn't fit.
