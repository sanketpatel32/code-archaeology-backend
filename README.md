# Code Archaeology Server

A Fastify-powered backend that analyzes Git repositories to extract insights about code complexity, ownership patterns, and development hotspots.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Framework**: [Fastify](https://fastify.dev/)
- **Database**: PostgreSQL
- **Queue**: Redis + [BullMQ](https://docs.bullmq.io/)
- **Linting**: [Biome](https://biomejs.dev/)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- PostgreSQL database
- Redis server

### Installation

```bash
# Install dependencies
bun install

# Copy environment variables
cp .env.example .env

# Edit .env with your credentials
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `CORS_ORIGIN` | Allowed origins | `http://localhost:3000` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `REDIS_URL` | Redis connection string | - |
| `GITHUB_TOKEN` | GitHub token for private repos | - |
| `WORKDIR` | Directory for cloned repos | `./.data` |

### Running

```bash
# Start the API server
bun run dev

# Start the background worker (separate terminal)
bun run worker
```

## Project Structure

```
server/
├── index.ts          # Server entry point
├── worker.ts         # Background job processor
├── src/
│   ├── app.ts        # Fastify app builder
│   ├── config/       # Environment schema
│   ├── lib/          # Database, utilities
│   ├── queue/        # BullMQ job queue
│   ├── routes/       # API endpoints
│   ├── services/     # Business logic
│   └── types/        # TypeScript types
└── db/               # Database migrations
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/analysis` | Start repository analysis |
| `GET` | `/analysis/:id` | Get analysis status |
| `GET` | `/repositories` | List analyzed repositories |
| `GET` | `/repositories/:id` | Get repository details |

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `bun run dev` | Start dev server |
| `worker` | `bun run worker` | Start background worker |
| `lint` | `bun run lint` | Run Biome linter |
| `format` | `bun run format` | Format code |
| `check` | `bun run check` | Lint + format + fix |

## Architecture

```
┌─────────────────┐     ┌─────────┐     ┌────────────────┐
│  Fastify API    │────▶│  Redis  │◀────│  Worker        │
│  (index.ts)     │     │  Queue  │     │  (worker.ts)   │
└────────┬────────┘     └─────────┘     └────────┬───────┘
         │                                       │
         └───────────────┬───────────────────────┘
                         ▼
                  ┌─────────────┐
                  │  PostgreSQL │
                  │  Database   │
                  └─────────────┘
```

## License

MIT
