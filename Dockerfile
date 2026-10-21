# Build stage: install everything and build the page with Vite.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries; without this, npm tries to compile it and fails (no compiler in the image).
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Runtime stage: production dependencies, the server source and the built page only.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/cockpit.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY version.txt ./
COPY drizzle ./drizzle
COPY src/server ./src/server
COPY --from=build /app/dist/web ./dist/web
USER node
EXPOSE 3000
CMD ["node", "src/server/index.ts"]
