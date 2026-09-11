# Deploying theflate

The app is two halves with very different needs:

- **The website** answers in milliseconds and can live anywhere.
- **The compressor** holds a CPU busy for minutes per job and needs a disk that
  survives restarts.

Most modern hosting (Vercel, Netlify, Cloudflare Workers) kills anything
running longer than about a second. Putting the compressor there does not
work - jobs get cut off mid-encode. The split below exists because of that one
constraint.

## Recommended setup

| Piece | Where | Cost |
| --- | --- | --- |
| Frontend (`ui/`) | Cloudflare Pages | free |
| Finished videos | Cloudflare R2 | free egress |
| API + compressor | Hetzner CX22 + Coolify | about EUR 3.79/mo |

R2 matters more than it looks. Serving video is the expensive part of this
product: at roughly USD 0.09/GB on AWS or GCP, a thousand downloads of a 1GB
file costs about USD 90. R2 charges nothing for egress, and the existing S3
export code already speaks its protocol.

## 1. The server

Create a **Hetzner CX22** (2 x86 cores, 4GB RAM, 40GB disk) running Ubuntu
24.04. Dedicated-core CCX plans are worth it later; CX22 is enough to launch.

Do not use a free-tier machine for this. The free options from Google, AWS and
Oracle all provide a *shared* slice of a core, and sustained encoding gets
throttled hard - a five minute job can take an hour or stall outright.

## 2. Install Coolify

Coolify is a self-hosted deployment dashboard: connect a Git repo and it
builds and runs your containers, renews TLS certificates, and redeploys on
push. It replaces hand-written nginx and systemd configuration.

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Open `http://<server-ip>:8000` and create the admin account immediately - the
instance is reachable by anyone who knows the address until you do.

## 3. Point DNS at the server

In Cloudflare DNS, create an `A` record for `api.yourdomain.com` pointing at
the server's IP. Leave the proxy **off** (grey cloud) for the first
deployment, or the TLS challenge cannot reach the server.

## 4. Deploy the API

In Coolify: **New Resource -> Docker Compose**, connect the repository, select
`docker-compose.yml`.

Set these environment variables:

```
THEFLATE_STORAGE=/tmp/theflate_output
THEFLATE_DB=/var/lib/theflate/theflate.db
THEFLATE_CORS_ORIGIN=https://yourdomain.com
THEFLATE_MAX_JOBS=2
```

`THEFLATE_MAX_JOBS=2` matters on a 2-core box. It defaults to the core count,
and allowing more concurrent encodes than there are cores makes every job
slower rather than increasing throughput.

Two settings that are easy to miss:

- **Persistent storage.** `/var/lib/theflate` holds the SQLite job database.
  Without a persistent volume, every deploy wipes all job history.
- **Port 8081.** The WebSocket listener for live recording runs inside the same
  process as the API. If only 8080 is published, that feature silently fails to
  connect.

## 5. Deploy the frontend

Cloudflare Pages, pointed at the `ui/` directory.

`NEXT_PUBLIC_*` values are compiled into the JavaScript bundle at **build**
time, so they must be set as build variables. Setting them at runtime does
nothing - the value is already baked in:

```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com
```

Note `wss://`, not `ws://`. A secure page cannot open an insecure WebSocket;
browsers block it outright.

## 6. Storage on R2

Create an R2 bucket and an API token, then use the existing export feature:

- Provider: S3-compatible
- Endpoint: `https://<account-id>.r2.cloudflarestorage.com`
- Region: `auto`

## Known limits

**One compressor machine only.** Job state lives in SQLite on local disk and
finished files are written to local storage. A second instance would have its
own separate database and see none of the first one's jobs. Going beyond one
machine means Postgres plus object storage, and that is the first thing to
change when demand requires it.

**Deploys interrupt running jobs.** Anything mid-encode dies with the old
container. Startup reconciliation marks those jobs failed so they surface as
errors rather than hanging on a frozen progress bar, but the work is lost and
the user must retry. Deploy when the queue is quiet.

**Two cores means one video at a time.** Expect a few minutes per job. That is
fine for launch; when people start queueing, resize the server - a one-line
change, and a good problem to have.

## Features that stay off at launch

Built, but not ready to enable:

- `THEFLATE_CHUNKED` - parallel chunked encoding. Correct and tested, but the
  progress bar freezes for the whole job and the gain on a single machine is
  modest. Worth enabling only across multiple machines.
- Live streaming and screen recording - no CI coverage, and browser-recorded
  webm often carries no duration, which the target-size maths depends on.
- Transcription - works, but Whisper competes with the encoder for the same two
  cores and can starve the feature people actually came for.
