# Vendix — Entorno de desarrollo local

Monorepo npm workspaces (`apps/*`, `libs/*`) con backend NestJS, frontend Angular y app móvil Expo.

El entorno local es **híbrido** desde el 2026-08-30: la base de datos, Redis, el backend y nginx
corren en Docker; el **frontend corre nativo en macOS**.

```
macOS (16 GB)                        VM de Colima (6 GiB)
┌──────────────────────┐             ┌────────────────────────────────┐
│ ng serve :4200       │◀────────────│ nginx :80 :443                 │
│  npm run dev:fe      │  HTTP + WS  │   vendix.com, *.vendix.com → FE│
│  HMR, watch FSEvents │             │   api.vendix.com          → BE │
└──────────────────────┘             │ backend :3000                  │
                                     │ postgres :5432   redis :6379   │
                                     └────────────────────────────────┘
```

**Por qué el frontend salió de Docker.** Medido el 2026-08-30 con el layout anterior:
`vendix_frontend` sostenía **5,4 GiB de su cgroup de 5,5 GiB (98,2 %)** y el host se quedaba con
**903 MB libres**. Dentro del contenedor, además, VirtioFS obliga a `--poll 5000` y a `--no-hmr`:
sondeo del sistema de archivos cada 5 s y recarga completa de página en cada cambio. Nativo, el
watch usa FSEvents y el HMR funciona.

---

## Requisitos previos

| Requisito | Cómo |
| --- | --- |
| **Node 22** (la matriz de Angular 20 acepta `^20.19 \|\| ^22.12 \|\| ^24`) | `nvm use` — el repo trae `.nvmrc` |
| **Colima + Docker CLI** | `brew install colima docker docker-compose` |
| **Entradas en `/etc/hosts`** | ver abajo |
| **CA local confiada** | ver `ssl/README-INSTALLATION.md` |

### `/etc/hosts`

```
127.0.0.1	vendix.com
127.0.0.1	www.vendix.com
127.0.0.1	api.vendix.com
```

Con esas tres basta para cualquier tenant. Los subdominios por tienda/organización
(`{slug}-shop.vendix.com`, `-store`, `-org`) son opcionales y se agregan a mano: no hay DNS wildcard
en local.

---

## Arranque local

```bash
# 1. VM y servicios en contenedor
colima start                 # 6 CPU / 6 GiB, según ~/.colima/default/colima.yaml
docker compose up -d         # db, redis, backend, nginx

# 2. Frontend nativo, en su propia terminal (se queda corriendo)
nvm use
npm run dev:fe
```

`npm run dev:fe` arranca `ng serve` con `--max-old-space-size=6144`, `--max-semi-space-size=64` y
`NG_BUILD_MAX_WORKERS=4`. Si necesitas correr algo pesado en paralelo (un buildcheck, tests, otra
sesión de agente), usa el presupuesto recortado:

```bash
npm run dev:fe:lite          # heap 3 GB, 2 workers
```

### Acceso

**Siempre por el vhost real, nunca por `http://localhost:4200`.**

| Qué | URL |
| --- | --- |
| Frontend | `https://vendix.com` |
| API | `https://api.vendix.com/api` |
| Tienda de un tenant | `https://{slug}-shop.vendix.com` |

El frontend resuelve qué aplicación renderizar a partir del hostname
(`GET /api/public/domains/resolve/{hostname}`, en `apps/frontend/src/app/core/services/app-config.service.ts`).
`localhost` no tiene fila en `domain_settings`, así que la app arranca mal. **El hostname es parte
del fixture de prueba, no un detalle de acceso.**

---

## Verificar que todo está arriba

```bash
docker compose ps                                  # db, redis, backend, nginx
curl -sk https://api.vendix.com/api/health         # {"status":"ok",...}
curl -sk -o /dev/null -w "%{http_code}\n" https://vendix.com/   # 200
```

Para el frontend, la señal sana es `Application bundle generation complete` en la terminal de
`npm run dev:fe`. No hay contenedor `vendix_frontend` que consultar con `docker logs`.

---

## Respaldo: volver a meter el frontend en Docker

El servicio sigue definido, bajo un perfil que no arranca solo:

```bash
docker compose --profile docker-fe up -d frontend
```

Antes, **apaga el `ng serve` nativo**: ambos publican el puerto 4200. Espera que consuma ~5,5 GiB
de la VM, así que tendrás que devolverle RAM (`colima stop && colima start --memory 10`).

---

## Comandos frecuentes

| Tarea | Comando |
| --- | --- |
| Logs del backend | `docker logs --tail 80 vendix_backend` |
| Reiniciar el backend | `docker restart vendix_backend` |
| Verificar compilación sin levantar servidores | `npm run buildcheck` (ver skill `buildcheck-dev`) |
| Barrer procesos huérfanos tras un run abortado | `npm run buildcheck:reap` |
| Reset + seed de la base | `npm run db:reset-seed` |
| Detener todo | `docker compose down` (nunca `down --volumes`: borra la base) |

## Variables de entorno

El backend lee `apps/backend/.env`. En el compose de desarrollo, `DATABASE_URL`, `REDIS_HOST` y
`NODE_ENV` se sobrescriben apuntando a los servicios de la red interna.

El frontend **no** usa variables de entorno: sus valores viven en
`apps/frontend/src/environments/environment.development.ts`, que apunta a `https://api.vendix.com/api`.

## Migraciones

Todo cambio de base de datos va por migración versionada de Prisma — nunca SQL manual directo.
Consulta la skill `vendix-prisma-migrations` antes de crear o editar cualquier migración.

## Documentación

Las guías operativas viven en `skills/`, no en `docs/`:

| Tema | Skill |
| --- | --- |
| Verificar builds y presupuesto de memoria | `buildcheck-dev` |
| Probar flujos end-to-end | `how-to-test` |
| Errores conocidos de Docker, VirtioFS y compilación | `vendix-known-errors` |
| Arquitectura del monorepo | `vendix-monorepo-workspaces` |
