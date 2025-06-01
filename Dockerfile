FROM oven/bun:latest AS build

WORKDIR /app

COPY package.json bun.lockb ./

RUN bun install --production

# runtime
FROM oven/bun:distroless AS runtime

COPY --from=build --chown=nonroot:nonroot /app/node_modules /app/node_modules
COPY src ./src

USER nonroot
EXPOSE 8787

CMD ["run", "--hot", "src/index.ts"]
