# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY prisma ./prisma
COPY . .
# Generate Prisma Client sin necesidad de base de datos
RUN npx prisma generate
RUN node -e "const {Prisma}=require('@prisma/client'); const models=Prisma.dmmf.datamodel.models; const has=(model,field)=>models.find(m=>m.name===model)?.fields.some(f=>f.name===field); const hasModel=(model)=>models.some(m=>m.name===model); const missing=[]; if(!has('organizations','fiscal_scope')) missing.push('organizations.fiscal_scope'); if(!has('accounting_entities','fiscal_scope')) missing.push('accounting_entities.fiscal_scope'); if(!has('dian_configurations','accounting_entity_id')) missing.push('dian_configurations.accounting_entity_id'); if(!hasModel('fiscal_scope_audit_log')) missing.push('fiscal_scope_audit_log'); if(missing.length){throw new Error('Generated Prisma Client is missing fiscal-scope schema: '+missing.join(', '));}"
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
CMD ["node", "dist/src/main.js"]
