FROM node:24-bookworm-slim
ENV NODE_ENV=production GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=8787 GATEWAY_DB=/app/var/gateway.sqlite
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /app/var && chown node:node /app/var
COPY --chown=node:node src ./src
COPY --chown=node:node policies ./policies
COPY --chown=node:node web ./web
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/cli.js", "serve"]
