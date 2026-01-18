<p align="center">
  <img src="https://img.shields.io/badge/Fastify-5.0-000000?style=for-the-badge&logo=fastify" alt="Fastify" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis" alt="Redis" />
  <img src="https://img.shields.io/badge/Bun-Runtime-F9F1E1?style=for-the-badge&logo=bun" alt="Bun" />
</p>

<h1 align="center">🏛️ Code Archaeology API</h1>

<p align="center">
  <strong>Powerful code analysis engine for repository insights</strong>
</p>

<p align="center">
  Deep Git history analysis • Hotspot detection • Ownership tracking<br/>
  Complexity metrics • Code quality scanning • Automated insights
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-api-reference">API Reference</a> •
  <a href="#-deployment">Deployment</a>
</p>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 📊 Repository Analysis
Deep analysis of Git history with commit-level granularity.

### 🔥 Hotspot Detection  
Identify high-risk files based on change frequency and complexity.

### 👥 Ownership Tracking
Map code ownership and calculate bus factor risks.

</td>
<td width="50%">

### 📈 Complexity Metrics
Track cyclomatic complexity trends over time.

### 🔍 Quality Scanning
SonarQube-style analysis for JavaScript/TypeScript.

### 💡 Insights Engine
Automated recommendations based on codebase patterns.

</td>
</tr>
</table>

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

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Start the API server
bun run dev

# Start the worker (separate terminal)
bun run worker
```

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `REDIS_URL` | ✅ | - | Redis connection string |
| `PORT` | ❌ | `3001` | API server port |
| `CORS_ORIGIN` | ❌ | `*` | Allowed origins |
| `WORKDIR` | ❌ | `./.data` | Clone directory |
| `ANALYSIS_MAX_COMMITS` | ❌ | `5000` | Max commits to analyze |

<details>
<summary><strong>📋 All Environment Variables</strong></summary>

```env
# Server
PORT=3001
CORS_ORIGIN=https://your-frontend.com
WORKDIR=./.data

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_URL=redis://localhost:6379

# Analysis
ANALYSIS_MAX_COMMITS=5000
ANALYSIS_RECENT_DAYS=90

# Complexity
COMPLEXITY_SNAPSHOT_INTERVAL=50
COMPLEXITY_MAX_SNAPSHOTS=20
COMPLEXITY_MAX_FILES=200
COMPLEXITY_MAX_FILE_BYTES=200000

# Insights
HOTSPOT_THRESHOLD=0.6
FRAGILITY_THRESHOLD=0.6
INSIGHTS_MAX_PER_CATEGORY=5
BUS_FACTOR_TOUCH_THRESHOLD=10
BUS_FACTOR_SHARE_THRESHOLD=0.7
```

</details>

## 📡 API Reference

### Health Check

```http
GET /health
```

### Start Analysis

```http
POST /api/analysis
Content-Type: application/json

{
  "repoUrl": "https://github.com/org/repo",
  "branch": "main",
  "maxCommits": 5000
}
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/analysis` | Start repository analysis |
| `GET` | `/api/repositories/:id/summary` | Repository summary |
| `GET` | `/api/repositories/:id/hotspots` | File hotspots |
| `GET` | `/api/repositories/:id/timeline` | Commit timeline |
| `GET` | `/api/repositories/:id/ownership` | Ownership data |
| `GET` | `/api/repositories/:id/complexity` | Complexity trends |
| `GET` | `/api/repositories/:id/insights` | Automated insights |
| `GET` | `/api/repositories/:id/quality` | Code quality report |
| `GET` | `/api/repositories/:id/fragility` | File coupling |

## 📁 Project Structure

```
src/
├── config/           # Environment configuration
├── lib/              # Database utilities
├── queue/            # BullMQ job definitions
├── routes/           # API endpoints
│   ├── analysis.ts
│   ├── health.ts
│   └── repositories.ts
└── services/         # Business logic
    ├── analysis.ts   # Commit analysis
    ├── complexity.ts # Complexity metrics
    ├── insights.ts   # Recommendations
    ├── ownership.ts  # Bus factor
    └── quality.ts    # Code scanning
```

## 🐳 Deployment

### Docker

```bash
# Build API image
docker build -t code-archaeology-api .

# Build Worker image
docker build -f Dockerfile.worker -t code-archaeology-worker .
```

### Northflank / Railway / Render

1. Create two services from this repository:
   - **API**: Uses `Dockerfile`, expose port 3001
   - **Worker**: Uses `Dockerfile.worker`, no port needed
2. Add environment variables to both
3. Deploy!

## 🔒 Security

| Feature | Status |
|---------|--------|
| Rate Limiting | ✅ 100 req/min |
| Helmet Headers | ✅ Enabled |
| CORS Protection | ✅ Configurable |
| Non-root Docker | ✅ Secure |

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start API with hot reload |
| `bun run start` | Production API server |
| `bun run worker` | Background job worker |
| `bun run lint` | Run Biome linter |
| `bun run format` | Format code |

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Runtime** | Bun |
| **Framework** | Fastify 5 |
| **Language** | TypeScript 5 |
| **Database** | PostgreSQL |
| **Queue** | BullMQ + Redis |
| **Analysis** | TypeScript AST |

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/sanketpatel32">Sanket Patel</a>
</p>

<p align="center">
  <a href="https://github.com/sanketpatel32/code-archaeology-backend/stargazers">⭐ Star this repo</a> •
  <a href="https://github.com/sanketpatel32/code-archaeology-backend/issues">🐛 Report Bug</a> •
  <a href="https://github.com/sanketpatel32/code-archaeology-backend/issues">💡 Request Feature</a>
</p>
