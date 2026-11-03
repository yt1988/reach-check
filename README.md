# Reach Check

**English** · [简体中文](README.zh-CN.md)

Can other people reach your website, NAS or game server, and if not, where does it stop? [Reach Check](https://reach.1ms.dog) connects to it from 18 regions around the world, including China Telecom, China Unicom and China Mobile, and once more from your own browser. Each region shows DNS, TCP, TLS and first-byte times; a failed connection shows the step it stopped at and what to check next.

**Live:** https://reach.1ms.dog (prototype, not deployed yet)

## What it checks

- **From 18 regions**: one [Globalping](https://globalping.io) probe each in mainland China (by carrier), Hong Kong, Taiwan, Tokyo, Korea, Singapore, India, Australia, London, Frankfurt, Russia, the UAE, South Africa, Los Angeles, New York and São Paulo. Each probe makes one HTTP(S) request to the port, which tells apart: answered as a web page, open but not a web service (SSH, Minecraft…), connection refused (nothing listening), timed out (dropped by a firewall, or no port forward), DNS failure, connection reset, TLS failure.
- **From your browser**: two HTTPS requests to the same address. A browser only sees how long a request took before it failed, so it tells "no answer at all" from "something answered", and for HTTPS pages splits the time into connection setup and the request. Ports browsers refuse to open (22, 25, 110, …) are named as such.
- **DNS**: the answers of AliDNS, Cloudflare and Google (over DoH, from the browser), private or carrier-grade NAT addresses in public records, Cloudflare's proxy (which only forwards a few HTTP ports), resolvers that disagree, and China's probes resolving the name differently from everyone else.
- **A verdict with next steps**: port forwarding, firewalls, no public IPv4 (CGNAT), ports blocked by home broadband, a service listening on 127.0.0.1 only, Cloudflare 52x errors, certificates, slow TCP handshakes (lost packets), and your own view disagreeing with the outside one (NAT loopback, a proxy).
- **Trace route** from any failed region, and an **invite link**: a friend opens it and their browser checks your service.

UDP ports (many game servers, WireGuard) can't be checked: neither a browser nor a public probe can tell whether a UDP port is open.

## Where it runs

Everything runs in the visitor's browser. The page calls Globalping's API directly, so each visitor uses their own allowance (250 probe results an hour per IP; one check uses 18). When it runs out the page says when it comes back. The site is static files only; no server sees what you check.

## Develop

```bash
npm run dev        # http://localhost:8787, with the production headers from public/_headers
```

Deploy with `npx wrangler deploy` (static assets only, nothing metered), then bind a domain in the Cloudflare dashboard.

```
public/index.html   the page
public/app.js       regions, Globalping, the browser check, DNS, the verdict
public/style.css    design tokens (shared with the other 1ms.dog tools) and layout
scripts/dev.mjs     local preview server
```

## License

MIT
