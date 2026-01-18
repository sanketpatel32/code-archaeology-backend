# ================================
# Code Archaeology - Backend API
# Optimized for Northflank
# ================================

# Stage 1: Install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Stage 2: Production image
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Install git for repo cloning functionality
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy dependencies and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create data directory with proper permissions
RUN mkdir -p .data && chown -R appuser:nodejs .data

# Switch to non-root user
USER appuser

# Northflank provides PORT env variable - default to 3001
ENV PORT=3001
ENV NODE_ENV=production

# Expose port (Northflank will use PORT env)
EXPOSE ${PORT}

# Health check using PORT env
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD bun --eval "fetch('http://localhost:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the API server
CMD ["bun", "run", "start"]
