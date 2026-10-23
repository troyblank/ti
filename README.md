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
| `OLLAMA_TIMEOUT_MS` | No | `240000` | How long a project chat waits for the model before returning `504`. Keep it under `300000`. |
| `DATA_DIR` | No | `data` | Directory projects and uploaded PDFs are stored in. Relative paths are resolved from the working directory. Inside Docker Compose this is set to `/app/data` (the mounted `./data` volume); this default is for `yarn dev`. |
| `MAX_PDF_BYTES` | No | `104857600` | Largest PDF an upload will accept, in bytes (100 MiB). |

## Commands

| Command     | Result                                                   |
| ----------- | -------------------------------------------------------- |
| yarn ollama | Starts the Ollama container. Required before `yarn dev`. |
| yarn dev    | Runs the API and restarts on file changes. Ollama must already be running. |
| yarn start  | Runs the API.                                            |
| yarn lint   | Checks repo for any lint or tsc issues.                  |
| yarn test   | Runs unit tests with coverage (100% threshold).          |
| yarn package | Builds `dist/ti-deploy.tar.gz` for deploying to the Synology. |

GitHub Actions ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs `yarn lint` and `yarn test` on every pull request and on pushes to `main`.

No build step is needed — Node 24 runs the TypeScript source directly via type stripping. Source files must therefore stick to [erasable syntax](https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly) (no `enum`, no parameter properties, etc.), which `tsc` enforces.

## API

| Method | Path          | Description                               |
| ------ | ------------- | ----------------------------------------- |
| GET    | `/health`     | Liveness check. Returns `{ "status": "ok" }`. |
| GET    | `/api/health` | Same as above, under the `/api` prefix.   |
| POST   | `/api/projects` | Creates a project. Body `{ "name": "..." }`. Returns `201` and `{ id, name, createdAt }`. |
| GET    | `/api/projects` | Lists projects, oldest first. |
| POST   | `/api/projects/:projectId/documents` | Stores one PDF in that project. Multipart field `file`. Returns `201` and `{ id, filename, size, uploadedAt }`. |
| POST   | `/api/projects/:projectId/chat` | Asks the local LLM inside that project. Body `{ "message": "..." }`, reply `{ "message": "<assistant text>" }`. |
| *any*  | `/api/conversations` | Placeholder — returns `501`. Conversation history lands in Phase 8. |

```sh
curl http://localhost:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Frosthaven"}'
```

```sh
curl http://localhost:3000/api/projects/<project-id>/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hello"}'
```

Errors are always JSON of the form `{ "error": "<HTTP status text>" }`:

* Unknown routes return `404`. A project id that is not a lowercase UUID, or a project that does not exist, is also `404`.
* A project `name` or chat `message` that is missing, not text, or blank returns `400`. A name over 255 characters, or a message over 4,000 characters, returns `413`.
* Project chat returns `504` if the model hasn't answered within `OLLAMA_TIMEOUT_MS`. If the client disconnects first, the Ollama request is cancelled.
* A project upload returns `400` when the `file` field is missing, more than one file is sent, or any other form field is included; `413` when the PDF exceeds `MAX_PDF_BYTES`; and `415` when the file is not a PDF (checked from the first 1024 bytes, before the rest is written). A rejected or cancelled upload is not kept.
* Client errors raised by middleware (e.g. malformed JSON → `400`, oversized body → `413`) keep their status.
* Anything else, including a failure to reach Ollama, is logged and returned as a generic `500`.

## Projects and uploading a PDF

A project is one subject — for example one board game — with its own documents and chat. Create one first. The name is only a label; the id in the response is what later requests use.

```sh
curl http://localhost:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Frosthaven"}'
```

```json
{
  "id": "6c1e0a2b-4d5f-4a6b-8c7d-9e0f1a2b3c4d",
  "name": "Frosthaven",
  "createdAt": "2026-10-23T22:00:00.000Z"
}
```

Uploading stores a PDF in that project. It does not read it, and chat does not use it yet. Text extraction is the next roadmap step; answers grounded in the project's documents come later, with RAG.

Leave the PDFs wherever they already are — Downloads, Documents, a shared folder. Do not copy them into the git repository. An upload copies one file into `data/`, which is git-ignored.

`yarn dev` writes that copy on the machine running the API, under this repository's `data/` directory. The API prints that path when it starts. Ollama does not need to be running. Restart `yarn dev` if it was already running from before projects existed.

The path after `@` is read by that process. In WSL, a PDF on the Windows side is under `/mnt/c/Users/...`, not a `C:\` path. `cd` to the folder and `pwd` prints the path curl wants.

```sh
curl -F "file=@/absolute/path/to/your.pdf" \
  http://localhost:3000/api/projects/<project-id>/documents
```

`file` is the form field name. `<project-id>` is the id returned when the project was created.

```json
{
  "id": "2f1c0e4a-7b3d-4e1a-9c2b-6d8e4f0a1b23",
  "filename": "your.pdf",
  "size": 1234567,
  "uploadedAt": "2026-10-08T21:22:00.000Z"
}
```

The stored files are `data/projects/<project-id>/documents/<id>/original.pdf` and `metadata.json` beside it. The original filename is saved in the metadata and is not used as a path. Uploading the same PDF again creates a new id; nothing is overwritten. PDFs uploaded before projects existed are still in `data/documents/` and are not moved; upload them again into a project.

An upload is written to `data/incoming/<id>/` first and moved under the project only once it is complete, so an interrupted upload never looks like a stored document. Creating a project is staged the same way. The API clears `data/incoming/` when it starts.

The API checks that it can write to `DATA_DIR` when it starts, and exits with `Cannot write to DATA_DIR "…"` if it can't. If Docker created `data/` for you (e.g. a `docker compose up` before the folder existed), it is owned by root; take it back with `sudo chown -R "$(id -u):$(id -g)" data`.

Docker Compose stores uploads in the same `./data` folder, mounted at `/app/data`. On the Synology that folder is the `data` directory next to the compose file, and the container's `node` user (uid 1000) has to be able to write to it (see [Deploying to the Synology](#deploying-to-the-synology)). Create `data/` yourself before the first `docker compose up`: if Docker creates it, it is owned by root and the `ti` container exits at startup with the `Cannot write to DATA_DIR` message.

## Docker

Build and run locally (starts both `ti` and Ollama):

```sh
docker compose up --build
```

Or run just the API without compose:

```sh
docker build -t ti .
docker run --rm -p 3000:3000 -e CORS_ORIGIN=http://localhost:5173 -v "$PWD/data:/app/data" ti
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

Or call Ollama's HTTP API from the host to check the model directly. TI does not use this endpoint; project chat calls Ollama's `/api/chat` instead:

```sh
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "In one sentence, what is a NAS?",
  "stream": false
}'
```

The response JSON includes the answer in `"response"`. Expect a few tokens per second on a CPU-only NAS; the first request after a restart is slower while the model loads into memory.

### Running `ti` on the host with Ollama in Docker

`yarn dev` runs the API outside Docker. The default `OLLAMA_URL=http://localhost:11434` in `.env` points it at the loopback port compose publishes, so start Ollama first with `yarn ollama` and leave that container running. Then project chat can reach the model. The first reply after a restart is slower while the model loads into memory.

## Deploying to the Synology

TI runs on the NAS through **Container Manager** (DSM 7.2+, installed from Package Center). The NAS builds the image itself from a small deploy bundle, so it needs neither git nor the full repo.

Ollama runs CPU-only on the NAS, so the hardware matters. The Ollama image supports both x86-64 and arm64, but most ARM-based Synology units have too little RAM and too slow a CPU to be usable, so in practice you want an x86 (Intel/AMD) model with at least 8GB of RAM for a 3B model (`llama3.2:3b` needs roughly 6GB free while answering). Expect a few tokens per second.

### First deploy

1. On your machine, run `yarn lint && yarn test && yarn package`. This creates `dist/ti-deploy.tar.gz` containing only what Docker needs (`Dockerfile`, `docker-compose.yml`, `package.json`, `yarn.lock`, `src/` without tests, `.env.example`).
2. In **File Station**, create `docker/ti` (i.e. `/volume1/docker/ti`), upload the bundle there, then right-click it → **Extract** → *Extract here*. Delete the `.tar.gz` afterwards.
3. Create the `.env` file in that folder from `.env.example` (e.g. copy it on your machine, edit it, and upload it as `.env`). Set `CORS_ORIGIN` to the origin the browser loads `ti-web` from — e.g. `http://localhost:5173` when running `ti-web`'s dev server on your laptop, even though the API itself is on the NAS. Set `OLLAMA_MODEL` if you want something other than the default. Compose reads `PORT`, `CORS_ORIGIN`, `OLLAMA_PORT`, `OLLAMA_MODEL` and `OLLAMA_TIMEOUT_MS` from this file.
4. Create a `data` folder in that same directory. Projects and uploaded PDFs are written there (`data/projects/<project-id>/`). The `ti` container runs as the `node` user (uid 1000), so it must be able to write to that folder. Via SSH: `sudo chown 1000:1000 /volume1/docker/ti/data`; or in File Station → `data` → Properties → Permission, grant *Everyone* read/write. Ollama creates its own `ollama` folder next to it for its models.
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
    projects/       # create and list projects; mounts a project's documents and chat
    documents/      # stores an uploaded PDF inside a project
    chat/           # asks the local LLM inside a project
    conversations/  # placeholder (501)
  utils/            # small shared helpers (e.g. isRecord)
```

To add a feature, create `src/api/<feature>/index.ts` exporting a `Router`, then mount it in `src/api/index.ts`.
