FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/api ./apps/api
COPY shared ./shared
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/server.ts"]
