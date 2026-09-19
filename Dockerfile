FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/package.json ./package.json
EXPOSE 8787
CMD ["node", "backend/dist/polling.js"]
