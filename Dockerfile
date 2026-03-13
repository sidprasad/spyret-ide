# Build stage
FROM node:20-bullseye AS builder

RUN apt-get update && apt-get install -y \
    make \
    git \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install dependencies (postinstall runs webpack + make)
# Skip postinstall here so we can copy source first
RUN npm install --ignore-scripts

# Copy the rest of the source
COPY . .

# Initialize git submodules if any
RUN git init && git submodule update --init --recursive 2>/dev/null || true

# Run the build (webpack + make web)
RUN npm run build

# Runtime stage
FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/build ./build

EXPOSE 4999

# Defaults mirror .env.example — override any of these at runtime via
# docker run -e KEY=value, --env-file, or Docker Compose environment:
ENV PORT=4999 \
    NODE_ENV=production \
    BASE_URL=http://localhost:4999 \
    ASSET_BASE_URL=http://localhost:5001 \
    LOG_URL=http://localhost:5002 \
    SESSION_SECRET=not-so-secret \
    REDISCLOUD_URL="" \
    CURRENT_PYRET_RELEASE="" \
    PYRET="http://localhost:4999/js/cpo-main.jarr" \
    POSTMESSAGE_ORIGIN="http://localhost:3000" \
    SHARED_FETCH_SERVER="https://code.pyret.org" \
    URL_FILE_MODE="all-remote" \
    IMAGE_PROXY_BYPASS="" \
    GOOGLE_CLIENT_ID="" \
    GOOGLE_CLIENT_SECRET="" \
    GOOGLE_API_KEY="" \
    GOOGLE_SERVER_API_KEY="" \
    GOOGLE_APP_ID=""

CMD ["node", "src/run.js"]
