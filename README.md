# TI

**TI (Troy Intelligence)** is a self-hosted personal AI API for asking questions about uploaded PDF documents. Answers are grounded exclusively in the user's documents using RAG and a local LLM running on a Synology NAS.

This repository is the backend. The frontend lives in the separate [`ti-web`](https://github.com/troyblank/ti-web) repository.

See [PLAN.md](./PLAN.md) for the full roadmap and architectural decisions.

## Global Requirements

* nvm
* Docker (for container builds / Synology deployment)

## Setup

1. run `nvm use`
2. run `yarn install`
3. copy `.env.example` to `.env` and adjust the variables below
4. run `yarn dev`

The API will be available at `http://localhost:3000`.

## Environment variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `PORT` | No | `3000` | Port the HTTP server listens on. |
| `HOST` | No | `0.0.0.0` | Interface to bind to. |
| `CORS_ORIGIN` | No | *(none)* | Comma-separated list of browser origins allowed to call the API, e.g. `http://localhost:5173`. Empty disallows all cross-origin browser requests. |

## Commands

| Command     | Result                                                   |
| ----------- | -------------------------------------------------------- |
| yarn dev    | Runs the API and restarts on file changes.               |
| yarn start  | Runs the API.                                            |
| yarn lint   | Checks repo for any lint or tsc issues.                  |
| yarn test   | Runs unit tests with coverage (100% threshold).          |
| yarn package | Builds `dist/ti-deploy.tar.gz` for deploying to the Synology. |

No build step is needed — Node 24 runs the TypeScript source directly via type stripping. Source files must therefore stick to [erasable syntax](https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly) (no `enum`, no parameter properties, etc.), which `tsc` enforces.

## API

| Method | Path          | Description                               |
| ------ | ------------- | ----------------------------------------- |
| GET    | `/health`     | Liveness check. Returns `{ "status": "ok" }`. |
| GET    | `/api/health` | Same as above, under the `/api` prefix.   |
| *any*  | `/api/documents` | Placeholder — returns `501`. PDF upload lands in Phase 3. |
| *any*  | `/api/chat` | Placeholder — returns `501`. Chat lands in Phase 2. |
| *any*  | `/api/conversations` | Placeholder — returns `501`. Conversation history lands in Phase 8. |

Errors are always JSON of the form `{ "error": "<HTTP status text>" }`:

* Unknown routes return `404`.
* Client errors raised by middleware (e.g. malformed JSON → `400`, oversized body → `413`) keep their status.
* Anything else is logged and returned as a generic `500`.

## Docker

Build and run locally:

```sh
docker compose up --build
```

Or without compose:

```sh
docker build -t ti .
docker run --rm -p 3000:3000 -e CORS_ORIGIN=http://localhost:5173 ti
```

Then:

```sh
curl http://localhost:3000/health
# {"status":"ok"}
```

## Deploying to the Synology

TI runs on the NAS through **Container Manager** (DSM 7.2+, installed from Package Center). The NAS builds the image itself from a small deploy bundle, so it needs neither git nor the full repo.

### First deploy

1. On your machine, run `yarn lint && yarn test && yarn package`. This creates `dist/ti-deploy.tar.gz` containing only what Docker needs (`Dockerfile`, `docker-compose.yml`, `package.json`, `yarn.lock`, `src/` without tests, `.env.example`).
2. In **File Station**, create `docker/ti` (i.e. `/volume1/docker/ti`), upload the bundle there, then right-click it → **Extract** → *Extract here*. Delete the `.tar.gz` afterwards.
3. Create the `.env` file in that folder from `.env.example` (e.g. copy it on your machine, edit it, and upload it as `.env`). Set `CORS_ORIGIN` to the origin the browser loads `ti-web` from — e.g. `http://localhost:5173` when running `ti-web`'s dev server on your laptop, even though the API itself is on the NAS. Compose reads `PORT` and `CORS_ORIGIN` from this file.
4. Create a `data` folder in that same directory. The container runs as the `node` user (uid 1000), so it must be able to write there once PDF uploads arrive (Phase 3). Via SSH: `sudo chown 1000:1000 /volume1/docker/ti/data`; or in File Station → `data` → Properties → Permission, grant *Everyone* read/write.
5. **Container Manager → Project → Create**: name `ti`, path `/volume1/docker/ti`, source *Use existing docker-compose.yml*. Finish — it builds the image and starts the container.
6. From your machine, check `curl http://<nas-ip>:3000/health` returns `{"status":"ok"}`. Container Manager should also show the container as *healthy*. If the request hangs, allow port 3000 from your LAN under Control Panel → Security → Firewall.

### Updating

1. Run `yarn lint && yarn test && yarn package` again.
2. In File Station, delete the old `src` folder in `docker/ti` (so files removed from the repo don't linger), upload the new bundle and extract it, choosing to overwrite existing files. `.env` and `data/` are not in the bundle, so they are left untouched.
3. **Container Manager → Project → `ti` → Action → Build** to rebuild the image and restart the container.

### Remote access

For now TI is only reachable on the local network. It must not be exposed to the Internet until authentication exists (Phase 6); remote access via a secure tunnel is Phase 7.

## Project structure

```text
src/
  serve.ts          # entrypoint: loads env, starts the HTTP server
  app.ts            # builds the Express app (middleware, routers, 404/500 handlers)
  config.ts         # environment-based configuration
  middleware/
    errors.ts       # JSON 404 / 501 / error handlers
  api/
    index.ts        # /api router — mounts feature routers
    health/         # GET /api/health
    documents/      # placeholder (501)
    chat/           # placeholder (501)
    conversations/  # placeholder (501)
```

To add a feature, create `src/api/<feature>/index.ts` exporting a `Router`, then mount it in `src/api/index.ts`.
