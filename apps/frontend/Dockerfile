# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app
# Contexto raíz (ver servicio `frontend` en `docker-compose.yml`): las rutas
# del COPY se resuelven desde la raíz del repo, no desde `apps/frontend`.
COPY apps/frontend/package*.json ./
RUN npm ci --omit=dev
COPY apps/frontend/ ./
# Kernel compartido de aritmética de dinero: el alias `@money-kernel` de
# `apps/frontend/tsconfig.json` apunta a `../backend/...`, que dentro de la
# imagen (con `WORKDIR /app`) es `/backend/...`. Sin esto el build falla con
# TS2307 porque `../backend` no existiría en la imagen.
COPY apps/backend/src/common/money-kernel/ /backend/src/common/money-kernel/
RUN npm run build -- --configuration=production

# ---- Nginx Stage ----
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
