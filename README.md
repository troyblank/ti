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
4. run `yarn ollama` and leave it running. `yarn dev` talks to Ollama at `http://localhost:11434`, so the container has to be up first. The model also has to be pulled once — see [Local LLM](#local-llm-ollama).
5. run `yarn dev`

The API will be available at `http://localhost:3000`.

## Environment variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `PORT` | No | `3000` | Port the HTTP server listens on. |
| `HOST` | No | `0.0.0.0` | Interface to bind to. |
| `CORS_ORIGIN` | No | *(none)* | Comma-separated list of browser origins allowed to call the API, e.g. `http://localhost:5173`. Empty disallows all cross-origin browser requests. |
| `OLLAMA_URL` | No | `http://localhost:11434` | Base URL of the Ollama server. Inside Docker Compose this is set to `http://ollama:11434`. |
| `OLLAMA_PORT` | No | `11434` | Loopback port Docker Compose publishes Ollama on, so `yarn dev` on the host can reach it. Must match `OLLAMA_URL`. |
| `OLLAMA_MODEL` | No | `llama3.2:3b` | Ollama model used to answer questions. Must be pulled first — see [Local LLM](#local-llm-ollama). |
| `OLLAMA_TIMEOUT_MS` | No | `240000` | How long `POST /api/chat` waits for the model before returning `504`. Keep it under `300000`. |

## Commands

| Command     | Result                                                   |
| ----------- | -------------------------------------------------------- |
| yarn ollama | Starts the Ollama container. Required before `yarn dev`. |
| yarn dev    | Runs the API and restarts on file changes. Ollama must already be running. |
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
| POST   | `/api/chat` | Asks the local LLM. Body `{ "message": "..." }`, reply `{ "message": "<assistant text>" }`. |
| *any*  | `/api/documents` | Placeholder — returns `501`. PDF upload lands in Phase 3. |
| *any*  | `/api/conversations` | Placeholder — returns `501`. Conversation history lands in Phase 8. |

```sh
curl http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hello"}'
```

Errors are always JSON of the form `{ "error": "<HTTP status text>" }`:

* Unknown routes return `404`.
* A `POST /api/chat` body without a non-empty string `message` returns `400`; a `message` over 4,000 characters returns `413`.
* `POST /api/chat` returns `504` if the model hasn't answered within `OLLAMA_TIMEOUT_MS`. If the client disconnects first, the Ollama request is cancelled.
* Client errors raised by middleware (e.g. malformed JSON → `400`, oversized body → `413`) keep their status.
* Anything else, including a failure to reach Ollama, is logged and returned as a generic `500`.

## Docker

Build and run locally (starts both `ti` and Ollama):

```sh
docker compose up --build
```

Or run just the API without compose:

```sh
docker build -t ti .
docker run --rm -p 3000:3000 -e CORS_ORIGIN=http://localhost:5173 ti
```

Then:

```sh
curl http://localhost:3000/health
# {"status":"ok"}
```

## Local LLM (Ollama)

TI's AI is a local LLM served by [Ollama](https://ollama.com), which `docker-compose.yml` runs as the `ollama` service alongside `ti`. No external AI API is involved: once a model has been downloaded, Ollama works with no Internet access at all.

* Ollama is **not** published on the network. Compose binds it to `127.0.0.1:11434` on the Docker host only, so `ti` (over the compose network as `http://ollama:11434`) and the host itself can reach it, but nothing else can.
* Downloaded models are stored in `./ollama` (git-ignored), kept separate from `ti`'s `./data`, so they survive container rebuilds.
* The model is chosen with `OLLAMA_MODEL`. The default, `llama3.2:3b` (~2GB), is the practical sweet spot for CPU-only hardware with 8–16GB of RAM. Models larger than 7B are not realistic on a NAS.

### Pulling the model

A model has to be downloaded once before it can be used. This is the only step that needs Internet access:

```sh
yarn ollama
docker compose exec ollama ollama pull llama3.2:3b
```

Use the same name you set in `OLLAMA_MODEL`. `docker compose exec ollama ollama list` shows what is installed.

### Verifying the model answers questions

Chat with it directly through the Ollama CLI inside the container:

```sh
docker compose exec ollama ollama run llama3.2:3b "In one sentence, what is a NAS?"
```

Or call Ollama's HTTP API from the host to check the model directly. TI does not use this endpoint; `POST /api/chat` calls Ollama's `/api/chat` instead:

```sh
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "In one sentence, what is a NAS?",
  "stream": false
}'
```

The response JSON includes the answer in `"response"`. Expect a few tokens per second on a CPU-only NAS; the first request after a restart is slower while the model loads into memory.

### Running `ti` on the host with Ollama in Docker

`yarn dev` runs the API outside Docker. The default `OLLAMA_URL=http://localhost:11434` in `.env` points it at the loopback port compose publishes, so start Ollama first with `yarn ollama` and leave that container running. Then `POST /api/chat` can reach the model. The first reply after a restart is slower while the model loads into memory.

## Deploying to the Synology

TI runs on the NAS through **Container Manager** (DSM 7.2+, installed from Package Center). The NAS builds the image itself from a small deploy bundle, so it needs neither git nor the full repo.

Ollama runs CPU-only on the NAS, so the hardware matters. The Ollama image supports both x86-64 and arm64, but most ARM-based Synology units have too little RAM and too slow a CPU to be usable, so in practice you want an x86 (Intel/AMD) model with at least 8GB of RAM for a 3B model (`llama3.2:3b` needs roughly 6GB free while answering). Expect a few tokens per second.

### First deploy

1. On your machine, run `yarn lint && yarn test && yarn package`. This creates `dist/ti-deploy.tar.gz` containing only what Docker needs (`Dockerfile`, `docker-compose.yml`, `package.json`, `yarn.lock`, `src/` without tests, `.env.example`).
2. In **File Station**, create `docker/ti` (i.e. `/volume1/docker/ti`), upload the bundle there, then right-click it → **Extract** → *Extract here*. Delete the `.tar.gz` afterwards.
3. Create the `.env` file in that folder from `.env.example` (e.g. copy it on your machine, edit it, and upload it as `.env`). Set `CORS_ORIGIN` to the origin the browser loads `ti-web` from — e.g. `http://localhost:5173` when running `ti-web`'s dev server on your laptop, even though the API itself is on the NAS. Set `OLLAMA_MODEL` if you want something other than the default. Compose reads `PORT`, `CORS_ORIGIN`, `OLLAMA_PORT`, `OLLAMA_MODEL` and `OLLAMA_TIMEOUT_MS` from this file.
4. Create a `data` folder in that same directory. The `ti` container runs as the `node` user (uid 1000), so it must be able to write there once PDF uploads arrive (Phase 3). Via SSH: `sudo chown 1000:1000 /volume1/docker/ti/data`; or in File Station → `data` → Properties → Permission, grant *Everyone* read/write. Ollama creates its own `ollama` folder next to it for its models.
5. **Container Manager → Project → Create**: name `ti`, path `/volume1/docker/ti`, source *Use existing docker-compose.yml*. Finish — it pulls the Ollama image, builds the `ti` image and starts both containers.
6. Download the model (the only step that needs Internet from the NAS). In **Container Manager → Container → `ollama` → Details → Terminal**, click *Create* to open a `bash` shell and run `ollama pull llama3.2:3b` (or whatever `OLLAMA_MODEL` is). Via SSH instead: `sudo docker exec ollama ollama pull llama3.2:3b`. The download is ~2GB and lands in `ollama/`.
7. In the same terminal, verify the model answers: `ollama run llama3.2:3b "In one sentence, what is a NAS?"`. The first answer takes a while as the model loads.
8. From your machine, check `curl http://<nas-ip>:3000/health` returns `{"status":"ok"}`. Container Manager should show both containers as *healthy*. If the request hangs, allow port 3000 from your LAN under Control Panel → Security → Firewall. Ollama's port 11434 is bound to the NAS's loopback only and must **not** be opened.

### Updating

1. Run `yarn lint && yarn test && yarn package` again.
2. In File Station, delete the old `src` folder in `docker/ti` (so files removed from the repo don't linger), upload the new bundle and extract it, choosing to overwrite existing files. `.env`, `data/` and `ollama/` (the downloaded models) are not in the bundle, so they are left untouched.
3. **Container Manager → Project → `ti` → Action → Build** to rebuild the image and restart the containers. Ollama keeps its models, so there is nothing to re-download.

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
    chat/           # POST /api/chat — asks the local LLM
    conversations/  # placeholder (501)
  utils/            # small shared helpers (e.g. isRecord)
```

To add a feature, create `src/api/<feature>/index.ts` exporting a `Router`, then mount it in `src/api/index.ts`.
