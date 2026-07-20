# CraftStudio — Project Context

This file is the authoritative context document for Claude Code sessions.
It describes the architecture, tech stack, data flow, and current implementation state of CraftStudio as of 2026-06-19.

---

## What CraftStudio Is

An agentic web app builder. The user types a natural-language prompt describing what they want to build. An AI agent (running inside an isolated sandbox) generates a Vite + React + Tailwind project, writes files, installs dependencies, and streams real-time progress back to the frontend. The result is a live preview URL and a browsable code editor in the right panel of the workspace.

---

## Monorepo Structure

```
D:\super-30\craftstudio\
├── apps/
│   ├── web/          Next.js 15 frontend
│   ├── backend/      Express 5 API server + WebSocket server
│   └── worker/       Headless background job processor
├── packages/
│   ├── database/     Prisma schema + PostgreSQL client (shared)
│   ├── redis/        Redis queue + pub/sub utilities (shared)
│   ├── ui/           Shared shadcn/ui components
│   ├── eslint-config/
│   └── typescript-config/
├── turbo.json        Turbo build pipeline
├── pnpm-workspace.yaml
└── package.json      Monorepo root (pnpm workspaces)
```

Build tool: Turbo 2.5.5 via pnpm workspaces.

---

## Tech Stack

| Layer        | Technology                                              |
|--------------|---------------------------------------------------------|
| Frontend     | Next.js 15.4.5, React 19, Redux Toolkit, Axios          |
| UI           | Tailwind CSS, shadcn/ui, Lucide React icons             |
| Code editor  | @monaco-editor/react 4.7.0 (read-only, client-side only)|
| Backend      | Express 5.1.0, Node.js                                  |
| WebSocket    | ws 8.18.3 (backend), native browser WebSocket (frontend)|
| AI / LLM     | OpenRouter API -> gpt-4o-mini via Vercel AI SDK 5.0.70  |
| Sandbox      | E2B code interpreter 2.0.1 (isolated Docker containers) |
| Database     | PostgreSQL + Prisma ORM                                 |
| Queue        | Redis via ioredis (brpop job queue + pub/sub for events)|
| File storage | Cloudflare R2 (S3-compatible, AWS SDK v3)               |
| Auth         | Magic links via Resend email + 7-day JWT session cookie |

---

## Database Schema (packages/database/schema.prisma)

### Models

**User**
- id, email, name, createdAt
- Relations: projects[], authTokens[]

**Project**
- id, name, description, userId, s3basePath, status (ACTIVE|BUILDING|ARCHIVED|FAILED), createdAt, updatedAt
- Relations: messages[], jobs[], sandboxSession[], changeSets[]
- s3basePath format: `projects/<userId>/<projectId>`

**Message**
- id, projectId, role (USER|ASSISTANT), content, type (CHAT|EDIT), parentMessageId, toolCalls (JSON), createdAt

**Job**
- id, projectId, type (PROMPT|DEPLOY|BUILD), status (PENDING|RUNNING|COMPLETED|FAILED), errorMessage, startedAt, completedAt

**SandboxSession**
- id (= E2B sandboxId), templateId, projectId, status (ACTIVE|EXPIRED|FAILED|COMPLETED), startedAt, endedAt

**ChangeSet**
- id, projectId, jobId, message, createdAt
- Relations: files[] (ChangeFile)

**ChangeFile**
- id, changeSetId, path, diff (unified diff string), isNew

**AuthToken**
- id, userId, token, expiresAt, used

---

## Backend (apps/backend)

### Entry point: src/index.ts
- Express app with HTTP server
- CORS for FRONTEND_URL env var
- WebSocket manager initialised on the server instance
- Routes mounted at `/api/v0/auth` and `/api/v0/projects`
- E2B template ID hardcoded: "35say9dtojwu03w1zcm9"
- Listens on PORT env var (default 8080)

### WebSocket: src/websocket.ts
- `WebSocketManager` singleton
- Clients connect with `?projectId=<id>` query param
- Subscribes to Redis `project:*` channels
- On Redis message: JSON.parse + broadcast to all clients on that projectId
- Handles graceful cleanup on disconnect

### Auth routes: src/v0/routes/authRouter.ts
```
POST /api/v0/auth/signup    -> signupOrSignin (magic link)
POST /api/v0/auth/signin    -> signupOrSignin (same)
GET  /api/v0/auth/signin/post -> verifyToken (called from email link)
GET  /api/v0/auth/me        -> getMe (protected)
POST /api/v0/auth/logout    -> logout
```

### Project routes: src/v0/routes/projectRouter.ts
```
POST /api/v0/projects                      -> createOrEditProject
GET  /api/v0/projects/getAll               -> getAllProjects
GET  /api/v0/projects/:id                  -> getProject (with messages, jobs, sessions, changeSets)
GET  /api/v0/projects/:id/files            -> getFiles (list S3 objects, strip node_modules)
GET  /api/v0/projects/:id/files/*filePath  -> getFileContent (stream S3 object as text)
```

### Key controller logic (src/v0/controllers/projectController.ts)
- `createOrEditProject`: if no projectId -> generate title via LLM, create Project + Message + Job, push to Redis queue; if projectId -> add Message + Job, validate sandbox session, push to queue
- `getFiles`: ListObjectsV2 on S3, strips s3basePath prefix, filters node_modules
- `getFileContent`: GetObjectCommand, streams body to string, returns `{ content, path, size }`

### Auth middleware: src/v0/middlewares/isAuthenticated.ts
- Reads `auth_token` cookie, verifies JWT, attaches `req.user = { userId, email }`

---

## Worker (apps/worker)

### Entry point: src/index.ts
The worker is a headless process. It blocks on `redis.brpop("prompt-queue", 0)` and processes one job at a time.

**Per job flow:**
1. Parse job payload: `{ jobId, projectId, messageId, activeSessionId }`
2. Fetch message + project from DB
3. Sandbox lifecycle:
   - If `activeSessionId` provided: try to reconnect via `Sandbox.reconnect()`
   - On reconnect failure: mark session EXPIRED, fall through to create new
   - Create new sandbox from E2B template (up to 2 retries), persist as SandboxSession
4. Start Vite dev server: `npm run dev` on port 5173 inside sandbox, poll vite.log for "Local:" readiness, capture public preview URL
5. Populate sandbox: download existing project files from S3 via `populateSandbox()`; on first run uses template
6. LLM execution:
   - Fetch last 20 messages from DB as conversation history
   - Call `streamText()` with gpt-4o-mini, tool suite, `stopWhen(stepCountIs(10))`
   - Stream tool calls/results in real-time via Redis pub/sub
7. File tracking: `fileChangesMap` accumulates old/new content for each modified file
8. S3 sync: `syncSandboxToS3()` uploads changed files after LLM finishes
9. ChangeSet: creates ChangeSet + ChangeFile records with unified diffs
10. Publish `JOB_COMPLETED` or `JOB_FAILED` to Redis

### Tools: src/tools.ts
All tools run inside the E2B sandbox via `sandbox.commands.run()` or `sandbox.filesystem.*`.

| Tool              | What it does                                                          |
|-------------------|-----------------------------------------------------------------------|
| `listFiles`       | Recursive file list, filters node_modules + hidden files              |
| `viewFile`        | Read file with optional startLine/endLine                             |
| `searchFiles`     | Regex search across source files (max 50 files)                       |
| `writeFile`       | Create or overwrite file; tracks old/new; publishes FILE_UPDATED      |
| `replaceLines`    | Replace line range in file; handles escaped \n and \t                 |
| `addDependency`   | `npm install <pkg>`; tracks package.json changes                      |
| `removeDependency`| `npm uninstall <pkg>`                                                 |
| `runCommand`      | Arbitrary bash in sandbox from /home/user                             |
| `runDevServer`    | Kill existing Vite, start fresh dev server                            |

After `writeFile` or `replaceLines`, the worker re-emits `PREVIEW_READY` with the current preview URL so the frontend iframe reloads.

### S3 utilities: src/s3.ts
- `populateSandbox(sandbox, s3basePath)`: download all project files from S3 into sandbox at /home/user/
- `syncSandboxToS3(sandbox, s3basePath, changedFiles)`: upload only the changed files back to S3

### E2B sandbox template (apps/backend/e2b.Dockerfile + e2b.toml)
- Node.js base image
- Vite React TypeScript template scaffolded at /home/user/
- Tailwind CSS v3, PostCSS, Autoprefixer pre-configured
- Vite config set to `host: "0.0.0.0"` so the dev server is publicly reachable
- Dev server on port 5173
- Template ID: "35say9dtojwu03w1zcm9"

---

## Redis (packages/redis)

### redis.ts
- Singleton `redis` (commands) + `redisSubscriber` (pub/sub) ioredis instances
- Env var: `REDIS_URL`

### queue.ts
- `addJobToQueue({ jobId, projectId, messageId, activeSessionId })`: `redis.lpush("prompt-queue", JSON.stringify(payload))`
- Worker consumes via `brpop("prompt-queue", 0)`

### Pub/sub channel pattern
- Channel: `project:<projectId>`
- All events are JSON strings with an `event` field

---

## Real-time Event Flow

```
Worker                   Redis                   Backend WebSocket         Frontend Redux
------                   -----                   -----------------         --------------
publish(project:<id>)  ->  broadcast           ->  wsEventReceived()    ->  websocketSlice
```

### Event types (defined in apps/web/lib/api/types.ts)

| Event              | Payload fields                                          | What frontend does                        |
|--------------------|---------------------------------------------------------|-------------------------------------------|
| JOB_STARTED        | jobId                                                   | jobStatus=running, clear changedFiles, clear previewUrl |
| SANDBOX_CREATED    | sandboxId, jobId, createDuration, populateDuration      | set activeSandboxId                       |
| SANDBOX_RECONNECTED| sandboxId, jobId, duration                              | set activeSandboxId                       |
| TOOL_CALL_START    | toolName, toolCallId                                    | push to activeTools                       |
| TOOL_CALL_END      | toolCallId, duration                                    | remove from activeTools                   |
| FILE_UPDATED       | path, isNew                                             | push to changedFiles (deduped)            |
| FILES_SYNCED       | jobId, duration                                         | (no-op currently)                         |
| CHANGESET_CREATED  | jobId, changedFilesCount, changeSetId                   | (no-op currently)                         |
| JOB_COMPLETED      | jobId, duration                                         | jobStatus=completed, clear activeTools    |
| JOB_FAILED         | jobId, error, duration                                  | jobStatus=failed, set error               |
| PREVIEW_READY      | previewUrl, jobId                                       | set previewUrl in state                   |

---

## Frontend (apps/web)

### Pages
- `app/page.tsx` — home/landing: hero prompt input, projects grid, LoginModal
- `app/project/[id]/page.tsx` — workspace: 400px chat panel (left) + WorkspacePanel (right)
- `app/layout.tsx` — root layout

### Redux Store (apps/web/store/)

**store.ts**: configures store with three slices: auth, project, websocket

**authSlice.ts**
- State: isAuthenticated, user, isLoading, error
- Thunks: getMeThunk, signupOrSigninThunk, logoutThunk

**projectSlice.ts**
- State: projects[], currentProject, messages[], isLoading, isSending, error, pendingPrompt, projectFiles[], selectedFilePath, selectedFileContent, isLoadingFiles, isLoadingFileContent
- Thunks: createProjectThunk, fetchProjectsThunk, fetchProjectThunk, sendMessageThunk, fetchProjectFilesThunk, fetchFileContentThunk
- Actions: setPendingPrompt, setCurrentProject, clearError, clearCurrentProject, addMessage, updateProjectStatus, setSelectedFilePath

**websocketSlice.ts**
- State: connected, projectId, currentJobId, jobStatus, activeSandboxId, activeTools[], lastEvent, changedFiles[], previewUrl, error
- Actions: wsConnected, wsDisconnected, wsEventReceived (handles all 11 event types), resetJobState, setJobPending, clearSandboxId

### Hooks
- `hooks/useProjectWebSocket.ts`: manages browser WebSocket connection, dispatches wsConnected/wsEventReceived/wsDisconnected

### Components

**Chat panel (components/chat/)**
- `ChatInterface.tsx`: message list + auto-scroll, sends via sendMessageThunk, dispatches setJobPending
- `ChatMessage.tsx`: renders USER/ASSISTANT messages with markdown + syntax highlighting
- `ChatInput.tsx`: textarea + submit, disabled during processing, supports CHAT|EDIT type
- `JobStatus.tsx`: real-time job progress, shows activeTools, changedFiles, job status badge

**Workspace panel (components/workspace/)**
- `WorkspacePanel.tsx`: Code|Preview tab bar, persists active tab in sessionStorage keyed by projectId, both panels mounted simultaneously (inactive hidden via CSS to prevent iframe reload on tab switch)
- `PreviewPanel.tsx`: iframe with 4 states (waiting/loading/ready/error), toolbar with URL pill + refresh + open-in-new-tab, reloads on PREVIEW_READY events via reloadKey bump
- `CodePanel.tsx`: file tree (sorted dirs-first), Monaco read-only editor, changed files get orange dot badge, re-fetches file list on JOB_COMPLETED

**Other components**
- `Header.tsx`, `PromptInput.tsx`, `ProjectCard.tsx`, `auth/LoginModal.tsx`, `providers.tsx`

### API layer
- `lib/api/types.ts`: all TypeScript interfaces for User, Project, Message, Job, SandboxSession, ChangeSet, WebSocket events
- `NEXT_PUBLIC_API_URL` env var for backend base URL (default: http://localhost:8080/api/v0)

---

## Complete Data Flow

### 1. Authentication
```
User enters email
-> Frontend: signupOrSigninThunk -> POST /api/v0/auth/signup
-> Backend: find/create user, generate 15-min token, send magic link via Resend (or log in dev)
-> User clicks link -> GET /api/v0/auth/signin/post?token=...
-> Backend: validate token, set 7-day JWT cookie, redirect to frontend /
-> Frontend: getMeThunk on load -> isAuthenticated = true
```

### 2. Create project
```
User types prompt on home page
-> Frontend: createProjectThunk -> POST /api/v0/projects { prompt, type }
-> Backend: generate title via gpt-4o-mini, create Project (status=BUILDING) + Message + Job
-> Backend: addJobToQueue({ jobId, projectId, messageId })
-> Frontend: redirect to /project/<id>
```

### 3. Process job (worker)
```
Worker: brpop("prompt-queue") -> receive { jobId, projectId, messageId, activeSessionId }
-> Reconnect to existing sandbox OR create new one (up to 2 retries)
-> Publish SANDBOX_CREATED or SANDBOX_RECONNECTED
-> Publish PREVIEW_READY with Vite dev server URL
-> populateSandbox: download project files from S3 into sandbox
-> Fetch last 20 messages for conversation context
-> streamText(gpt-4o-mini, tools, stopWhen(stepCountIs(10)))
  -> per tool call: publish TOOL_CALL_START / TOOL_CALL_END
  -> per writeFile/replaceLines: publish FILE_UPDATED + PREVIEW_READY
-> syncSandboxToS3: upload changed files
-> Create ChangeSet + ChangeFile records with unified diffs
-> Publish CHANGESET_CREATED, JOB_COMPLETED (or JOB_FAILED)
```

### 4. Real-time frontend updates
```
Redis publish(project:<id>, event)
-> Backend WebSocketManager: broadcast to all clients on that projectId
-> Frontend useProjectWebSocket hook: dispatch wsEventReceived(event)
-> websocketSlice reducer: update state (jobStatus, previewUrl, changedFiles, activeTools, etc.)
-> React components re-render reactively
```

### 5. Send follow-up message (edit)
```
User types in ChatInput
-> sendMessageThunk: optimistic user message added, POST /api/v0/projects { projectId, prompt, type, sandboxId }
-> Backend: validate existing sandbox session, create Message + Job, addJobToQueue with activeSessionId
-> Worker picks up, reconnects to existing sandbox (no cold start), runs LLM again
```

---

## Environment Variables

### Backend (apps/backend/.env)
```
PORT=8080
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...
FRONTEND_URL=http://localhost:3000
OPENROUTER_API_KEY=...
E2B_API_KEY=...
AWS_REGION=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
BUCKET_NAME=craftstudio
RESEND_API_KEY=...
```

### Worker (apps/worker/.env)
Same as backend minus PORT, FRONTEND_URL. Needs: DATABASE_URL, REDIS_URL, OPENROUTER_API_KEY, E2B_API_KEY, AWS_*, BUCKET_NAME.

### Frontend (apps/web/.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:8080/api/v0
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

---

## Current Implementation State

### Backend — ~90% complete
- Auth (magic link, JWT, cookie): DONE
- Project CRUD: DONE
- File listing from S3: DONE
- File content from S3: DONE
- WebSocket server + Redis pub/sub bridge: DONE
- Job queue (addJobToQueue): DONE
- Deployment endpoint: NOT IMPLEMENTED

### Worker — ~90% complete
- Job queue consumption: DONE
- Sandbox lifecycle (create, reconnect, retry): DONE
- Vite dev server startup + preview URL: DONE
- S3 populate + sync: DONE
- LLM execution with tool suite: DONE
- ChangeSet / diff creation: DONE
- PREVIEW_READY emission (on start + after each file write): DONE
- Error handling + JOB_FAILED: DONE

### Frontend — ~80% complete (after 2026-06-19 session)
- Auth flow (magic link, protected routes): DONE
- Home page (prompt input, projects grid): DONE
- Project page shell (header, layout, WebSocket connection): DONE
- Chat panel (messages, input, job status, optimistic UI): DONE
- Workspace panel with tab switching: DONE
- Tab persistence per project (sessionStorage): DONE
- Preview tab (iframe, all states, toolbar, live reload on PREVIEW_READY): DONE
- Code tab (file tree, Monaco read-only editor, changed file badges): DONE
- Collapsible folder tree in code panel: NOT IMPLEMENTED (folders always expanded)
- Diff viewer (ChangeSet/ChangeFile unified diffs): NOT IMPLEMENTED
- Deploy tab / button: NOT IMPLEMENTED
- Project settings / rename / delete: NOT IMPLEMENTED
- Error boundary for workspace panel: NOT IMPLEMENTED

---

## Known Risks and Constraints

1. **Sandbox timeout**: E2B sandbox has a 5-minute timeout (timeoutMs: 1000*60*5). If the user is idle, the sandbox expires. The worker handles this by marking the session EXPIRED and creating a new one, but this adds cold-start latency on the next message.

2. **iframe sandbox attribute**: PreviewPanel uses `sandbox="allow-scripts allow-same-origin allow-forms allow-modals"`. This blocks top-navigation (user can't be redirected out). If the generated app tries to use Web Workers or Service Workers, they will be blocked — add `allow-same-origin` carefully.

3. **Monaco SSR**: Monaco is loaded with `next/dynamic` and `ssr: false`. It will not render during server-side rendering. This is intentional and correct.

4. **File content not re-fetched after job**: When a job completes and rewrites files, the CodePanel re-fetches the file *list* (on JOB_COMPLETED) but does not re-fetch the *content* of the currently open file. The user must click the file again to see updated content.

5. **createProjectThunk URL bug**: The URL in createProjectThunk is `${API_URL}/api/v0/projects` which double-prefixes `/api/v0` because API_URL already includes it. This was present before the current session and has not been fixed. fetchProjectFilesThunk and fetchFileContentThunk use `${API_URL}/projects/...` (correct). sendMessageThunk and fetchProjectThunk also have the double-prefix issue — pre-existing.

6. **LLM step limit**: Worker caps LLM at 10 tool steps per job (`stopWhen(stepCountIs(10))`). Complex tasks may be cut short.

7. **No streaming of assistant message**: The assistant's final text message is only available after JOB_COMPLETED (fetched via fetchProjectThunk refetch). There is no streaming of the LLM text output to the frontend.
