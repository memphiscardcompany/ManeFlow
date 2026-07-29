FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public
COPY integrations ./integrations
COPY db ./db
COPY scripts ./scripts

RUN mkdir -p /app/.runtime /var/lib/maneflow/scan-jobs \
    && chown -R node:node /app /var/lib/maneflow
USER node

EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4321/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
