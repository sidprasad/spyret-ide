FROM node:20-bullseye AS builder
RUN apt-get update && apt-get install -y make build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
    && npm ci --ignore-scripts
COPY . .
ARG GOOGLE_CLIENT_ID=""
ARG GOOGLE_API_KEY=""
ARG GOOGLE_APP_ID=""
ARG STATIC_BASE_PATH=""
RUN npm run build

FROM nginx:stable-alpine
ARG STATIC_BASE_PATH=""
COPY --from=builder /app/build/static/ /usr/share/nginx/html${STATIC_BASE_PATH}/
EXPOSE 80
