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
# Copy package files first
COPY --from=builder /app/package*.json ./
# Copy all node_modules including generated Prisma client
COPY --from=builder /app/node_modules ./node_modules
# Copy the compiled application
COPY --from=builder /app/dist ./dist
# Copy Prisma schema and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
# Environment files are NOT copied - secrets are loaded from AWS Secrets Manager in production
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
