# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY prisma ./prisma
COPY . .
# Generate Prisma Client sin necesidad de base de datos
RUN npx prisma generate
RUN npm run build
RUN npm prune --production

# ---- Production Stage ----
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY .env* ./
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
