# Security headers

The Content Security Policy and related headers for `terraoracle.io` and
`draw.terraoracle.io` are **not set in this repository**. They are applied by
Cloudflare, in the `terraoracle.io` zone:

> Rules → Transform Rules → Response Header Transform Rules

| Rule | Matches |
| --- | --- |
| `security headers` | `http.host eq "terraoracle.io"` |
| `security headers draw` | `http.host eq "draw.terraoracle.io"` |

This file mirrors those rules so the policy can be reviewed and its history
tracked like code. **Whenever a rule changes in Cloudflare, update this file in
the same change.**

To see what is actually served:

```bash
curl -sI https://terraoracle.io/home      | grep -i content-security
curl -sI https://draw.terraoracle.io/     | grep -i content-security
```

Last verified: 23 September 2026.

---

## terraoracle.io

### Content-Security-Policy (enforced)

```
frame-ancestors 'self';
object-src 'none';
base-uri 'self';
form-action 'self' https://formspree.io;
script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'
           https://static.cloudflareinsights.com;
connect-src 'self'
            https://terra-oracle-questions.vladislav-baydan.workers.dev
            https://oracle-chat.vladislav-baydan.workers.dev
            https://oracle-draw.vladislav-baydan.workers.dev
            https://oracle-eye.vladislav-baydan.workers.dev
            https://s.terraoracle.io
            https://draw.terraoracle.io
            https://baydashaaa.github.io
            https://api.coingecko.com
            https://fcd.terra-classic.hexxagon.io
            https://lcd.terra-classic.hexxagon.io
            https://terra-classic-fcd.publicnode.com
            https://terra-classic-lcd.publicnode.com
            https://formspree.io
            https://static.cloudflareinsights.com
            https://echo.walletconnect.com
            https://pulse.walletconnect.org
            https://rpc.walletconnect.org
            https://verify.walletconnect.com
            https://verify.walletconnect.org
            wss://relay.walletconnect.org
            wss://relay.walletconnect.com
```

### Content-Security-Policy-Report-Only

Logs, never blocks. Used to learn what a stricter policy would break before
enforcing it.

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'
           https://static.cloudflareinsights.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https://draw.terraoracle.io;
frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com;
worker-src 'self' blob:;
connect-src   (same list as the enforced policy);
object-src 'none';
base-uri 'self';
form-action 'self' https://formspree.io;
frame-ancestors 'self'
```

### Other headers set by the same rule

| Header | Value |
| --- | --- |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |

---

## draw.terraoracle.io

### Content-Security-Policy (enforced)

```
frame-ancestors 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'
           https://static.cloudflareinsights.com
```

`connect-src` is not restricted here yet. The report-only policy below
carries the candidate list.

### Content-Security-Policy-Report-Only

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'
           https://static.cloudflareinsights.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https://terraoracle.io;
frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com;
worker-src 'self' blob:;
connect-src 'self'
            https://terraoracle.io
            https://oracle-draw.vladislav-baydan.workers.dev
            https://fcd.terra-classic.hexxagon.io
            https://lcd.terra-classic.hexxagon.io
            https://terra-classic-fcd.publicnode.com
            https://terra-classic-lcd.publicnode.com
            https://static.cloudflareinsights.com
            https://echo.walletconnect.com
            https://pulse.walletconnect.org
            https://rpc.walletconnect.org
            https://verify.walletconnect.com
            https://verify.walletconnect.org
            wss://relay.walletconnect.org
            wss://relay.walletconnect.com;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

The rule also sets `Permissions-Policy`; see the rule in Cloudflare for its
current value.

---

## Decisions

**No third-party script CDNs.** The QR generator and the WalletConnect client
(`@walletconnect/sign-client@2.17.4`) are served from `assets/vendor/` on both
sites. They used to load from `unpkg.com` and `esm.sh`, which gave those CDNs
the same privileges as our own code; an ESM import from a CDN cannot be pinned
with Subresource Integrity. How the WalletConnect bundle is built is described
in `assets/vendor/wc-init.js`.

**Terra Classic nodes are verified, not remembered.** Every node in
`connect-src` answered `/cosmos/base/tendermint/v1beta1/blocks/latest` with
HTTP 200 on 22 September 2026. The code previously referenced several
misspelled or retired hostnames. Before adding a node, check it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://HOST/cosmos/base/tendermint/v1beta1/blocks/latest"
```

**`form-action` includes formspree.** The Ask Oracle form posts to
`https://formspree.io`. A bare `form-action 'self'` would break it.

**`unsafe-eval` is still enforced, on purpose.** The site's own code does not
evaluate strings, and the report-only policy confirms it: every eval
violation observed so far comes from scripts that browser wallet extensions
inject into all pages. Before removing `unsafe-eval` from the enforced
policy, connect and sign a transaction with each supported wallet extension
(Keplr, Station, Galaxy Station) while watching for report-only violations.

**`unsafe-inline` remains.** Removing it requires moving roughly two hundred
inline event handlers (`onclick="..."` and similar) out of the markup. That is
tracked as separate work.

---

## Changing a rule

1. Add or change the directive in the **report-only** header first.
2. Use the site with the browser console open, filtered by `Report Only`,
   with **Preserve log** enabled, across every page and wallet flow.
3. When the report stays clean, move the change into the enforced header.
4. Verify with `curl` and update this file in the same change.

Rolling back is a matter of restoring the previous value in Cloudflare, which
takes effect within seconds.
