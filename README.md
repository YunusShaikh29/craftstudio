# CraftStudio

An AI-powered web app builder that generates React applications from natural language prompts. Users describe what they want to build, and CraftStudio's AI agent generates a complete Vite + React + Tailwind project with live preview.

[main workspace screenshot]

## Features

- **AI-Powered Code Generation** — Natural language to working React apps
- **Isolated Sandboxes** — Each project runs in secure E2B containers
- **Real-time Preview** — Instant live preview with hot reload
- **Persistent Storage** — Projects saved to Cloudflare R2
- **Code Validation** — Automatic JSX/TSX and CSS syntax validation
- **WebSocket Updates** — Real-time job progress and file updates
- **Monaco Editor** — Full-featured code viewer with syntax highlighting

## Architecture

### Monorepo Structure

```
apps/
  ├── web/          Next.js 15 frontend (React 19, Redux Toolkit)
  ├── backend/      Express API + WebSocket server
  └── worker/       Background job processor (LLM + E2B sandboxes)

packages/
  ├── database/     Prisma schema + PostgreSQL client
  ├── redis/        Redis queue + pub/sub utilities
  ├── ui/           Shared shadcn/ui components
  ├── eslint-config/
  └── typescript-config/
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15.4.5, React 19, Redux Toolkit, Monaco Editor |
| **UI** | Tailwind CSS, shadcn/ui, Lucide React |
| **Backend** | Express 5.1.0, WebSocket (ws 8.18.3) |
| **AI/LLM** | OpenRouter API (gpt-4o-mini) via Vercel AI SDK 5.0.70 |
| **Sandboxes** | E2B Code Interpreter 2.0.1 |
| **Database** | PostgreSQL + Prisma ORM |
| **Queue** | Redis (ioredis) — job queue + pub/sub |
| **Storage** | Cloudflare R2 (S3-compatible) |
| **Auth** | Magic links via Resend + JWT cookies |

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- PostgreSQL database
- Redis server
- Cloudflare R2 account
- E2B API key
- OpenRouter API key
- Resend API key (for auth emails)

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment variables (see .env.example in each app)
# Required: DATABASE_URL, REDIS_URL, E2B_API_KEY, OPENROUTER_API_KEY, R2_*, RESEND_API_KEY

# Generate Prisma client
pnpm --filter database generate

# Run database migrations
pnpm --filter database prisma migrate deploy

# Build all packages
pnpm build
```

### Development

Run all services in development mode:

```bash
# Terminal 1: Backend API + WebSocket server
pnpm --filter backend dev

# Terminal 2: Worker (job processor)
pnpm --filter worker dev

# Terminal 3: Frontend
pnpm --filter web dev
```

Or use Turbo to run everything:

```bash
pnpm dev
```

## Screenshots

### Authentication
[login screen screenshot]

### Project Dashboard
[project dashboard screenshot]

### Workspace
[workspace with code editor screenshot]

[workspace with preview screenshot]

### Chat Interface
[chat interface with ai interaction screenshot]

## User Flow

### 1. Sign In
Users authenticate using magic links sent to their email. No passwords required.

[auth flow screenshot]

### 2. Create Project
From the dashboard, users can create a new project by describing what they want to build in natural language.

[create project screenshot]

### 3. AI Generation
The AI agent processes the prompt and generates code in real-time. Users see:
- Live progress updates via WebSocket
- Tool calls (write-file, replace-lines, etc.)
- File changes as they happen

[ai generation in progress screenshot]

### 4. Live Preview
As files are created, the preview updates automatically. Users can:
- View the live application in an iframe
- Browse and read generated code in Monaco editor
- Continue chatting with AI to make changes

[live preview screenshot]

### 5. Iterate
Users can request changes, add features, or fix issues by simply describing what they want.

[iteration example screenshot]

## How It Works

1. **User Input** — User types a prompt describing the app they want to build
2. **Job Creation** — Backend creates a Job record and pushes to Redis queue
3. **Worker Processing** — Worker picks up job, creates/reconnects E2B sandbox
4. **AI Generation** — LLM generates code using validated tools (write-file, replace-lines, etc.)
5. **Syntax Validation** — All JSX/TSX and CSS code validated before writing to sandbox
6. **Live Preview** — Vite dev server started in sandbox, preview URL sent to frontend
7. **File Sync** — Changes synced to Cloudflare R2 for persistence
8. **Real-time Updates** — WebSocket events keep frontend in sync with job progress

## Key Features

### Code Validation

CraftStudio validates all AI-generated code before writing to prevent broken previews:

- **JSX/TSX Validation** — Balanced tags, braces, parentheses
- **CSS Validation** — Balanced braces, function parentheses, attribute selectors
- **Error Handling** — Failed validation returns error to AI for correction

### Sandbox Reconnection

Workers reconnect to existing sandboxes when possible to preserve state:

- Sandboxes timeout after 5 minutes of inactivity
- Vite health checks don't abort successful reconnections
- Failed reconnections create new sandbox and load files from R2

### Preview Restart

Users can restart expired previews without consuming AI tokens:

- Detects expired sandboxes (> 5 minutes old)
- Creates new sandbox and starts Vite server
- No LLM execution required

## Adding UI Components

To add shadcn/ui components:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Components are stored in `packages/ui/src/components` and can be imported:

```tsx
import { Button } from "@workspace/ui/components/button"
```

## Project Status

**Core Features**
- AI code generation with tool calling
- Isolated E2B sandboxes with Vite preview
- Real-time WebSocket updates
- File persistence to R2
- Magic link authentication
- Code syntax validation (JSX/TSX/CSS)
- Sandbox reconnection with health checks
- Zero-token preview restart

**Planned Features**
- Project deployment
- Collaborative editing
- Version control integration
- Custom templates

## Contributing

See [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) for detailed architecture documentation.

## License

MIT
