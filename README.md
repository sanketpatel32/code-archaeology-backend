# 🏛️ Code Archaeology - Backend

A powerful code analysis API that uncovers the hidden history of your repositories. Analyze commit patterns, identify hotspots, track code ownership, and measure technical debt.

## ✨ Features

- **📊 Repository Analysis** - Deep analysis of Git history across any public repository
- **🔥 Hotspot Detection** - Identify files with high change frequency and complexity
- **👥 Ownership Tracking** - Understand who owns what code and identify bus factor risks
- **📈 Complexity Metrics** - Track cyclomatic complexity trends over time
- **🔍 Quality Analysis** - SonarQube-style code quality scanning for JS/TS
- **💡 Insights Engine** - Automated recommendations based on codebase patterns
- **⏱️ Timeline Analysis** - Visualize commit activity and churn over time

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh) - Fast JavaScript runtime
- **Framework**: [Fastify](https://fastify.io) - High-performance web framework
- **Database**: PostgreSQL (via Supabase)
- **Queue**: BullMQ + Redis - Background job processing
- **Analysis**: TypeScript AST parsing for code quality

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- PostgreSQL database
- Redis instance

### Installation

```bash
# Clone the repository
git clone https://github.com/sanketpatel32/code-archaeology-backend.git
cd code-archaeology-backend

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your database and Redis credentials
```

### Environment Variables

```env
# Required
DATABASE_URL=postgresql://user:password@host:5432/database
REDIS_URL=redis://localhost:6379

# Server
PORT=3001
CORS_ORIGIN=http://localhost:3000
WORKDIR=./.data

# Analysis Settings
ANALYSIS_MAX_COMMITS=5000
ANALYSIS_RECENT_DAYS=90
```

### Running Locally

```bash
# Start the API server (with hot reload)
bun run dev

# Start the background worker (separate terminal)
bun run worker
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start API server with hot reload |
| `bun run start` | Start API server (production) |
| `bun run worker` | Start background job worker |
| `bun run lint` | Run Biome linter |
| `bun run format` | Format code with Biome |

## 📁 Project Structure

```
server/
├── src/
│   ├── config/       # Environment configuration
│   ├── lib/          # Database and utilities
│   ├── queue/        # BullMQ job definitions
│   ├── routes/       # API endpoints
│   └── services/     # Business logic
│       ├── analysis.ts     # Commit analysis
│       ├── complexity.ts   # Complexity metrics
│       ├── insights.ts     # Recommendations engine
│       ├── quality.ts      # Code quality scanning
│       └── ownership.ts    # Bus factor analysis
├── db/
│   └── schema.sql    # Database schema
├── index.ts          # API entry point
├── worker.ts         # Worker entry point
├── Dockerfile        # API container
└── Dockerfile.worker # Worker container
```

## 🐳 Docker Deployment

### Build Images

```bash
# API Server
docker build -t code-archaeology-api .

# Background Worker
docker build -f Dockerfile.worker -t code-archaeology-worker .
```

### Deploy to Northflank

1. Create two services pointing to this repository
2. **API Service**: Use `Dockerfile`, enable public HTTP port 3001
3. **Worker Service**: Use `Dockerfile.worker`, no public port needed
4. Add environment variables to both services

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/analysis` | Start repository analysis |
| `GET` | `/api/repositories/:id/summary` | Get repository summary |
| `GET` | `/api/repositories/:id/hotspots` | Get file hotspots |
| `GET` | `/api/repositories/:id/timeline` | Get commit timeline |
| `GET` | `/api/repositories/:id/ownership` | Get ownership data |
| `GET` | `/api/repositories/:id/complexity` | Get complexity trends |
| `GET` | `/api/repositories/:id/insights` | Get automated insights |
| `GET` | `/api/repositories/:id/quality` | Get code quality report |

## 🔒 Security

- Rate limiting: 100 requests/minute per IP
- Helmet security headers enabled
- CORS protection configured
- Non-root Docker user

## 📝 License

MIT License - See [LICENSE](LICENSE) for details.

---

Built with ❤️ by [Sanket Patel](https://github.com/sanketpatel32)
