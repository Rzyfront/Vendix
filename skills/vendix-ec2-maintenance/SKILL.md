---
name: vendix-ec2-maintenance
description: >
  Vendix EC2 production maintenance: GitHub Actions→ECR→EC2 deploy, targeted Docker cleanup,
  CloudWatch-first diagnosis, safe SSH/AWS access. Trigger: EC2 deploy failures, disk pressure, Docker
  pull/layer errors, server cleanup.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "EC2 maintenance, deployment disk issues, or Docker layer/pull failures"
---

# Vendix EC2 Maintenance

## Source of Truth

- `.github/workflows/deploy-backend-ec2.yml`
- `.github/workflows/deploy-s3.yml`
- backend monitoring services under `apps/backend/src/domains/superadmin/monitoring/`
- `docker-compose.yml`

## Production Reality

- Backend is built in GitHub Actions, pushed to ECR, and deployed on EC2.
- Frontend is deployed separately to S3/CloudFront, not through the EC2 backend workflow.
- Deploy workflow fetches secrets from AWS Secrets Manager.

## Access Expectations

- Do not hard-require a user-provided local `.pem` path in the skill text.
- For this repo, automation commonly uses GitHub secret `VENDIX_SSH_PRIVATE_KEY` and resolves host/instance data through AWS.
- If manual access is needed, confirm the approved access method first: AWS CLI, SSM/SSH, bastion, or a provided key.

## Diagnosis Order

Prefer evidence in this order:

1. GitHub Actions deploy logs.
2. Superadmin infrastructure/monitoring views backed by CloudWatch.
3. AWS CLI inspection if available.
4. SSH only when server-level state is needed.

## Deploy blue/green

Fuente: `.github/workflows/deploy-backend-ec2.yml`. El API de produccion corre en dos slots fijos; solo uno esta activo y el viejo queda **detenido** (no borrado) como rollback.

| Pieza | Valor |
| --- | --- |
| Slot blue | `vendix-backend-blue`, host `127.0.0.1:3001` |
| Slot green | `vendix-backend-green`, host `127.0.0.1:3002` |
| Puerto interno del contenedor | `3000` (sin cambios); el `3000` del host ya no se publica y se cierra en el security group |
| Nginx | `proxy_pass http://vendix_api;` |
| Upstream | `/etc/nginx/conf.d/vendix-upstream.conf`: `upstream vendix_api { server 127.0.0.1:<puerto>; }` |
| Conmutacion | `nginx -t && nginx -s reload` |
| Worker | `vendix-backend-worker`, se reemplaza en serie |

Legado: el primer deploy tras el cambio aun puede encontrar `vendix-backend` en `3000`; los comandos deben caer a ese nombre si no hay slot corriendo.

Resolver slot activo y puerto (en el host):

```bash
API=$(sudo docker ps --filter 'name=^/vendix-backend-(blue|green)$' --filter status=running --format '{{.Names}}' | head -1); API=${API:-vendix-backend}
PORT=$(grep -oE '127\.0\.0\.1:[0-9]+' /etc/nginx/conf.d/vendix-upstream.conf | cut -d: -f2)
curl -fsS http://127.0.0.1:$PORT/api/health
```

Orden del deploy (no reordenar):

1. **Preflight de memoria**: exigir >= 2500 MB disponibles (conviven dos APIs un rato en un `t3.large` compartido con Redis y worker); si no hay, abortar antes de tocar nada.
2. **Migraciones** (`prisma migrate deploy` en contenedor temporal) antes de levantar el slot nuevo.
3. **Slot nuevo** (el inactivo) con la imagen nueva, rol `api`.
4. **Health 200 + `API_READY`** en el log del slot nuevo, directo a su puerto.
5. **Switch de nginx**: reescribir el puerto del upstream, `nginx -t && nginx -s reload`.
6. **Health publico** (`https://api.vendix.online/api/health`).
7. **Drenaje 30 s** de conexiones en vuelo.
8. **Stop del slot viejo** (`docker stop`, sin `rm`).
9. **Seeds** de produccion en contenedor temporal.
10. **Worker en serie**: reemplazar `vendix-backend-worker` de a uno.

Rollback: `docker start <slot_viejo>`, reapuntar el upstream a su puerto, `nginx -t && nginx -s reload`, health publico. Funciona mientras el slot viejo siga detenido y no se haya vuelto a desplegar sobre el.

**Por que nunca rol `all`**: `all` arranca API + procesos de background (colas, cron, SSE) en el mismo proceso. Con dos slots, uno detenido y el otro activo, no pasa nada; pero durante la ventana de solape `all` duplicaria workers/cron y consumiria el doble de memoria. El API usa rol `api`; el trabajo de fondo vive solo en `vendix-backend-worker`.

## Disk / Docker Cleanup

Avoid blanket `docker system prune -a -f` as the default advice.

Prefer the repo’s targeted cleanup sequence when disk pressure or layer registration failures appear:

- container prune
- image prune
- volume prune
- builder prune
- package/cache cleanup as used in deploy automation

Be careful with persistent infra components such as shared Docker network/Redis state.

## Common Symptoms

- `no space left on device`
- Docker layer registration or pull failures
- stale images/containers consuming disk during deploy

`npm install` failure is not a primary EC2 deploy symptom for this repo because production backend images are built before reaching the instance.

## Live Infra Note

AWS CLI checks such as `aws sts get-caller-identity` are safe for validating access context. Use live infra reads only when repository evidence is insufficient.

## Changelog

- 2026-10-14: seccion "Deploy blue/green" (slots blue/green, upstream nginx `vendix_api`, orden, rollback, preflight 2500 MB). El `3000` deja de publicarse.

## Related Skills

- `vendix-cloud-operations` - General AWS CLI, SSH, and private production runbook orientation.
- `vendix-monorepo-workspaces`
- `buildcheck-dev`
- `git-workflow`
