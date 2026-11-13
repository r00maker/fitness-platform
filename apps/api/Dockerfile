# One image runs both the API and the worker (different start commands).
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @studio/api build && pnpm --filter @studio/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
# The help guide the support assistant reads.
COPY --from=build /app/docs/help ./docs/help
COPY --from=build /app/docs/PRODUCT_NOTES.md ./docs/PRODUCT_NOTES.md
ENV MIGRATIONS_DIR=/app/drizzle
# Run as an unprivileged user, never root.
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
