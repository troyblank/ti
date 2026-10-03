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

No build step is needed — Node 24 runs the TypeScript source directly via type stripping. Source files must therefore stick to [erasable syntax](https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly) (no `enum`, no parameter properties, etc.), which `tsc` enforces.

## API

| Method | Path          | Description                               |
| ------ | ------------- | ----------------------------------------- |
| GET    | `/health`     | Liveness check. Returns `{ "status": "ok" }`. |
| GET    | `/api/health` | Same as above, under the `/api` prefix.   |

Future endpoints (`/api/documents`, `/api/chat`, `/api/conversations`) will be added under `/api` as the roadmap progresses. Unknown routes return a JSON `404`.

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

On the Synology, use Container Manager → Project and point it at this repo's `docker-compose.yml`. The `./data` volume is where uploaded PDFs and indexes will be stored in later phases; it is git-ignored.

## Project structure

```text
src/
  serve.ts          # entrypoint: loads env, starts the HTTP server
  app.ts            # builds the Express app (middleware, routers, 404/500 handlers)
  config.ts         # environment-based configuration
  api/
    index.ts        # /api router — mounts feature routers
    health/         # GET /api/health
```
