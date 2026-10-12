FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock .npmrc ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
# Env is validated at build time but read at runtime; the placeholder is not baked in.
RUN PERPLEXITY_API_KEY=build-placeholder bun run build && ! grep -rq build-placeholder build

# The server bundle has no runtime dependencies; bun provides sqlite and password hashing.
FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=data/search.db
COPY --from=build /app/build build
COPY package.json ./
COPY scripts scripts
COPY src/lib/server/schema.ts src/lib/server/schema.ts
RUN mkdir data && chown bun:bun data
USER bun
EXPOSE 3000
CMD ["bun", "build/index.js"]
