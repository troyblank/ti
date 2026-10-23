# TI — Development Plan

## Project

**TI (Troy Intelligence)** is a self-hosted personal AI application for asking questions about uploaded PDF documents.

The goal is to provide a ChatGPT-like experience where the AI's answers are grounded exclusively in the user's uploaded documents.

The AI and document data should remain on privately controlled infrastructure whenever practical.

---

# Core Goals

* Run the AI locally on a Synology NAS.
* Allow users to upload PDF documents.
* Organize documents into projects (e.g. one per board game), each with its own chat.
* Ask natural-language questions about a project's documents.
* Use RAG rather than training a model on the documents.
* Return useful source/page citations.
* Do not require Internet access for the AI itself.
* Make the web interface accessible remotely.
* Use Amazon Cognito for authentication.
* Keep the architecture simple enough for a personal project.
* Avoid recurring AI costs where practical.

---

# Repositories

## `ti`

Private/backend AI system.

Responsibilities:

* HTTP API
* PDF ingestion
* PDF text extraction
* OCR
* Document chunking
* Embeddings
* Vector search
* RAG
* Local LLM integration
* Document storage
* Conversation handling
* Authentication/authorization validation

The `ti` application will be deployed using Docker on the Synology NAS.

## `ti-web`

Separate frontend application.

Responsibilities:

* User interface
* Authentication
* Project list
* PDF upload UI
* Document library
* Chat interface
* Conversation history
* Displaying answers and citations

`ti-web` communicates with the `ti` API.

---

# High-Level Architecture

```text
User
 │
 │ HTTPS
 ▼
ti-web
 │
 │ authenticated API requests
 ▼
Secure tunnel
 │
 ▼
Synology
 │
 └── ti
      ├── API
      ├── PDF processing
      ├── Embeddings
      ├── RAG
      ├── Vector database
      └── Local LLM
```

The exact tunnel and deployment configuration will be decided later.

---

# AI Knowledge Boundary

TI should answer questions using information from the user's uploaded documents.

If the answer cannot be found in the available documents, TI should clearly state that the information could not be found.

The AI should not browse the Internet.

The local AI environment should ideally have no Internet access.

---

# Development Philosophy

Build TI incrementally.

Each development step should produce a working system.

Do not implement multiple major subsystems simultaneously unless there is a good reason.

Prefer simple solutions over unnecessary infrastructure.

Avoid prematurely selecting technologies that have not yet been proven necessary.

When an architectural decision is made, document it here.

---

# Decisions

## Phase 1

* **Runtime:** Node 24 running TypeScript directly via native type stripping — no build step. Source must use erasable syntax only (enforced by `tsc` with `erasableSyntaxOnly`).
* **HTTP framework (`ti`):** Express 5. Widely known, minimal, sufficient for a personal project.
* **Routing layout (`ti`):** feature routers live in `src/api/<feature>/` and are mounted under `/api` by `src/api/index.ts`. `GET /health` is additionally exposed at the root for Docker health checks and the Phase 1 success criteria.
* **Configuration:** environment variables loaded with `dotenv`, parsed and validated in `src/config.ts` (`PORT`, `HOST`, `CORS_ORIGIN`).
* **CORS:** `ti` only allows browser origins listed in `CORS_ORIGIN`; `ti-web`'s origin must be added there.
* **Docker:** `node:24-alpine` image running as the non-root `node` user, with a `/health` `HEALTHCHECK`. `docker-compose.yml` mounts `./data` for future PDF/index storage (git-ignored).
* **Frontend (`ti-web`):** Vite + React 19 + TypeScript. API base URL comes from `VITE_TI_API_URL` (default `http://localhost:3000`). No data-fetching or UI libraries yet — add them when a feature needs them.
* **API structure (`ti`):** feature routers are mounted under `/api`. `conversations` stays a `501` placeholder until its roadmap step. `documents` was the same until Phase 3. Shared HTTP middleware lives in `src/middleware/`.
* **Error responses:** every error is JSON `{ "error": "<HTTP status text>" }`. Client (4xx) errors raised by middleware keep their status; everything else is logged and returned as a generic `500` so internals never leak.
* **Testing:** `ti` uses Jest + supertest; `ti-web` uses Vitest + React Testing Library (Vitest handles `import.meta.env` natively under Vite). Both enforce 100% coverage.

## Phase 2

* **LLM runtime:** Ollama, run as an `ollama` service in `docker-compose.yml` next to `ti` (one Container Manager project on the Synology). CPU-only; no external AI API. Once a model is pulled it needs no Internet.
* **Model:** configurable via `OLLAMA_MODEL`, defaulting to `llama3.2:3b` — the practical ceiling for a CPU-only NAS with 8–16GB RAM. Models are pulled manually once (`ollama pull`) and persisted in `./ollama` (a sibling of `./data`, so `ti` never sees them) so rebuilds don't re-download them.
* **Network exposure:** Ollama is reachable by `ti` over the compose network (`http://ollama:11434`) and published on the Docker host's loopback only (`127.0.0.1:11434`) for verification and `yarn dev`. It is never exposed to the LAN or Internet; only `ti` talks to it.
* **Configuration:** `ti` reads `OLLAMA_URL` and `OLLAMA_MODEL` in `src/config.ts` (validated like the other variables) so the Chat API can be built on them without further plumbing.
* **Chat API:** `POST /api/chat` accepts `{ "message": "<text>" }` and returns `{ "message": "<assistant reply>" }`. It calls Ollama's `/api/chat` with `stream: false`, using `OLLAMA_URL` and `OLLAMA_MODEL`. There is no system prompt and no document context yet. A missing, non-string, or blank `message` is `400`; one over 4,000 characters (`MAX_MESSAGE_LENGTH`, about 1,000 tokens) is `413`, so prompts are never silently truncated by the model's context window. The Ollama request is cancelled if the client disconnects, and after `OLLAMA_TIMEOUT_MS` (default 240s, under Node fetch's own 300s limit) it is cancelled and the client receives `504`. If Ollama cannot be reached, returns an error status (its reason is logged), or returns an unexpected payload, the failure is logged and the client receives a generic `500`.

## Phase 3

* **Document storage:** Each upload is a directory `documents/<uuid>/` inside `DATA_DIR` (default `./data`, git-ignored). Docker sets `DATA_DIR=/app/data`, which `docker-compose.yml` mounts from `./data` — on the Synology that folder sits next to the compose file. Uploads are written to `incoming/<uuid>/` and renamed into `documents/` only after the metadata is saved, so an interrupted upload never appears as a document; `incoming/` is cleared at startup. At startup the API also checks that `DATA_DIR` is writable and exits with a clear message if it is not (a Docker-created `./data` is root-owned). The PDF is stored as `original.pdf`. The caller's filename is metadata only and is never used as a filesystem path, so an upload cannot choose where the bytes land. Nothing under `data/` is committed.
* **Metadata:** `metadata.json` beside the PDF holds `id`, `filename` (the base name, at most 255 characters), `size`, and `uploadedAt`. It stores no absolute path, so the same folder can move between a laptop and the NAS. Uploading the same file again creates a new id.
* **Upload API:** `POST /api/documents` takes `multipart/form-data` with one field, `file`. Success is `201` and that metadata. A missing file, a file sent under another field name, more than one file, or any extra form field is `400` (extra fields are refused so a request cannot buffer unbounded text in memory). A body over `MAX_PDF_BYTES` (default 100 MiB) is `413`. A file whose first 1024 bytes do not contain the `%PDF-` marker is `415`; this is checked while streaming, before the rest is written. Filenames are read as UTF-8, and any client-sent directory is dropped. A client that disconnects mid-upload is cleaned up without being logged as an error. This step only stores the PDF. Chat does not read documents yet. Projects (roadmap step 7) are next and will move uploads under a project.
* **Local uploads:** `yarn dev` writes into `./data` on the machine running the API. Ollama does not need to be running. Upload with `curl -F "file=@/absolute/path/to/file.pdf" http://localhost:3000/api/documents`. The PDF stays wherever it already lives; the path after `@` only has to be readable by that process. Do not put PDFs in the git repo.

---

# Development Roadmap

## Phase 1 — Application Foundation

### 1. Basic API ✅

Create the initial Dockerized API.

Requirements:

* Docker support
* HTTP server
* `GET /health`
* Environment-based configuration
* `.env.example`
* `.gitignore`
* Basic README

Success criteria:

```text
GET /health

→ HTTP 200

{
  "status": "ok"
}
```

---

### 2. API Structure ✅

Establish a clean structure for future API functionality.

Potential areas:

```text
/api
  /health
  /documents
  /chat
  /conversations
```

Do not implement unnecessary functionality yet.

---

### 3. Connect `ti-web` ✅

Create the initial communication between:

```text
ti-web → ti
```

The frontend should be able to call `/health` and display the result.

---

# Phase 2 — Local AI

### 4. Add Ollama ✅

Run Ollama locally through Docker or the appropriate Synology configuration.

Goals:

* Run a local LLM.
* Verify that the model can answer basic questions.
* Ensure the model does not require an external AI API.

---

### 5. Create Chat API ✅

Add an endpoint similar to:

```text
POST /chat
```

Example:

```json
{
  "message": "Hello"
}
```

Return the local LLM's response.

At this stage, there is no PDF/RAG functionality yet.

---

# Phase 3 — PDF Processing

### 6. PDF Upload ✅

Add:

```text
POST /documents
```

Allow PDF files to be uploaded to TI.

Requirements:

* Store PDFs on the Synology.
* Generate a document ID.
* Store basic metadata.
* Do not store PDFs in Git.

---

### 7. Projects

Group documents into projects. A project is one subject — for example, one board game — with its own rulebooks, FAQs, and chat.

Questions asked in a project must only be answered from that project's documents.

Proposed shape (finalize as a Decision when implemented):

```text
POST /api/projects                        create a project
GET  /api/projects                        list projects
POST /api/projects/:projectId/documents   upload a PDF into a project (replaces POST /api/documents)
POST /api/projects/:projectId/chat        ask a question within a project (replaces POST /api/chat)
```

Storage:

```text
data/projects/<projectId>/project.json
data/projects/<projectId>/documents/<documentId>/original.pdf
data/projects/<projectId>/documents/<documentId>/metadata.json
```

Requirements:

* Generate a project ID; the project's display name is metadata only, never a path.
* Every document belongs to exactly one project.
* Uploading to a project that does not exist is `404`.
* Documents uploaded before this step are not migrated; re-upload them into a project.

---

### 8. PDF Text Extraction

Extract text from uploaded PDFs.

The system should preserve page boundaries so citations can eventually identify the page containing the relevant information.

---

### 9. OCR

Add OCR support for PDFs that contain scanned/image-based pages.

The system should determine whether normal text extraction is sufficient before performing OCR when practical.

---

# Phase 4 — RAG

### 10. Document Chunking

Split extracted document text into chunks appropriate for embedding and retrieval.

Chunks should retain metadata such as:

* Project ID
* Document ID
* Filename
* Page number
* Chunk position

---

### 11. Embeddings

Use a local embedding model.

The embedding model should run locally rather than sending document content to an external service.

---

### 12. Vector Database

Select and integrate a vector database.

The initial implementation should favor simplicity and low maintenance.

Candidate technologies may include:

* SQLite-based vector storage
* Qdrant
* PostgreSQL/pgvector
* Other lightweight local options

Do not choose a vector database until the requirements are clearer.

---

### 13. RAG Chat

Update the project chat endpoint so that questions:

1. Generate a query embedding.
2. Search only the current project's documents.
3. Retrieve relevant chunks.
4. Provide those chunks to the local LLM.
5. Generate an answer.
6. Return source information.

Target flow:

```text
Question
   ↓
Embedding
   ↓
Vector search
   ↓
Relevant PDF chunks
   ↓
Local LLM
   ↓
Answer + Sources
```

---

# Phase 5 — Citations

Answers should identify the documents and pages used to generate the answer.

Example:

```text
Answer:

A character becomes exhausted when...

Sources:

- Frosthaven Rulebook — page 42
- Frosthaven FAQ — page 7
```

Citations should be generated from actual retrieved document chunks rather than invented by the LLM.

---

# Phase 6 — Authentication

Integrate Amazon Cognito.

Goals:

* Login
* Logout
* JWT/access-token handling
* Backend token validation
* User identity

Projects should be associated with the authenticated user. Documents belong to a project, so they inherit its owner.

The backend must enforce project and document ownership.

---

# Phase 7 — Remote Access

Deploy `ti-web` so it can be accessed remotely.

Connect:

```text
Internet
   ↓
ti-web
   ↓
Secure tunnel
   ↓
Synology
   ↓
ti
```

The `ti` API should not be directly exposed to the public Internet.

Potential tunnel technology:

* Cloudflare Tunnel

Final implementation TBD.

---

# Phase 8 — Application Features

Potential future features:

* Document library
* Delete/re-index documents
* Rename/delete projects
* Conversation history (per project)
* Rename documents
* Search document
