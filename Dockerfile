FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.22.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/server src/server
COPY drizzle drizzle
COPY version.txt ./
COPY --from=build /app/dist/web dist/web
USER node
CMD ["node", "src/server/index.ts"]
