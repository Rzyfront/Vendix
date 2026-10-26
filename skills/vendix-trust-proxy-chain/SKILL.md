---
name: vendix-trust-proxy-chain
description: >
  IP real del cliente (`req.ip`) tras la cadena de proxies: `TRUST_PROXY_HOPS`, `createTrustProxyPredicate`, topología de prod. Trigger: añadir/quitar proxy, gateway, CDN, ALB o WAF; rate limit que bloquea a todos o a nadie; leer la IP del cliente.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Poniendo un gateway, CDN, ALB o WAF delante del backend"
    - "Cambiando TRUST_PROXY_HOPS o el valor de trust proxy de Express"
    - "Depurando un rate limit que bloquea a todos los usuarios a la vez"
    - "Depurando un rate limit que no frena a un atacante"
    - "Leyendo la IP del cliente en un controlador, guard, middleware o log"
    - "Agregando una regla, cuota o auditoría llaveada por IP"
    - "Modificando client-ip.util.ts o la configuración de trust proxy en main.ts"
    - "Cambiando la topología de red de producción (nginx, Route53, CloudFront)"
---

## Cuándo usar

Rate limit, auditoría o cualquier regla/cuota por IP; ruta de migración para meter un gateway/CDN delante del backend sin abrir un bypass del rate limit; cambios en `client-ip.util.ts`, trust proxy en `main.ts` o topología (nginx, Route53, CloudFront).

# Cadena de proxies de confianza (trust proxy)

## La regla de una línea

`TRUST_PROXY_HOPS` es **la cantidad de proxies que vos controlás entre internet y el
backend**. No es la cantidad de cajas en el diagrama, no es una estimación, y no se sube
"por si acaso".

## Por qué esto importa tanto

`req.ip` es la entrada de todo el rate limit (`rate-limit.middleware.ts`), del
`VendixThrottlerGuard` y de la auditoría por IP. Si `req.ip` está mal, el sistema falla —
y falla de dos maneras **asimétricas**:

| Valor | Qué pasa | Gravedad |
| --- | --- | --- |
| **Muy bajo** | `req.ip` colapsa a la IP de tu propio proxy. Todos los clientes comparten una cubeta. Diez peticiones legítimas bloquean a la plataforma entera. | Caída de disponibilidad. **Ruidosa, visible, recuperable.** |
| **Muy alto** | El cliente antepone una entrada falsa en `X-Forwarded-For` y se le cree. IP nueva en cada petición ⇒ cubeta nueva en cada petición. | **Bypass total del rate limit. Silencioso.** Nadie se entera. |

> **Ante la duda, quedate corto.** Un número bajo se nota el mismo día; uno alto no se nota nunca.

## Por qué un predicado y no un número

`main.ts` NO pasa el número a Express:

```ts
app.getHttpAdapter().getInstance().set('trust proxy', createTrustProxyPredicate(trustProxyHops));
```

- **`true`**: Express toma el PRIMER elemento del XFF, el que escribe el cliente. Nunca.
- **`N` pelado**: confía en N saltos incondicionalmente; una conexión directa también es el salto 0 y su XFF se acepta.
- **Predicado** `(addr, hop) => hop === 0 ? isPrivateAddress(addr) : hop < hops`: el salto 0 se confía sólo si viene de una dirección privada (proxy propio); un golpe directo desde internet conserva la IP real.

El predicado **sólo protege el salto 0**; desde el salto 1 decide por conteo, así que el conteo tiene que ser exacto. Si hace falta más margen, confiar por **dirección** (rangos de egreso del gateway) dentro de `createTrustProxyPredicate`, nunca subir el número.

## Topología de producción (resumen)

`api.vendix.online` → registro A a la EIP del EC2 → nginx en el host (añade `X-Forwarded-For` con `$proxy_add_x_forwarded_for`) → contenedor `vendix-backend-blue` (127.0.0.1:3001) o `-green` (:3002). El puerto 3000 ya no se publica. **Un solo proxy propio ⇒ `TRUST_PROXY_HOPS=1`.** CloudFront **no** está delante de la API (solo `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, `pwa/*`, sin rate limit). El DNS es la autoridad sobre el camino real, no el diagrama ni la consola.

## Meter un gateway/ALB/WAF/CDN delante

1. Contar saltos desde el DNS (`dig +short api.vendix.online`).
2. Verificar si cada salto **añade** o **reemplaza** el XFF (uno que reemplaza no suma salto).
3. Desplegar el gateway **sin** tocar `TRUST_PROXY_HOPS` (estado degradado esperado: `client_ip` = IP de egreso del gateway).
4. Recién ahí subir el valor en Secrets Manager `vendix/production/app` (leer, fusionar, verificar conteo de claves: `put-secret-value` reemplaza el JSON entero) y redesplegar.
5. Correr la sonda de dos curls.

**Siempre gateway primero, `hops` después.** Al revés se abre una ventana de falsificación activa.

**Sonda (obligatoria tras cualquier cambio de topología):** `/api/health` expone `client_ip` y `trust_proxy_hops`. A) sin cabecera debe devolver tu IP pública. B) con `-H 'X-Forwarded-For: 6.6.6.6'` debe devolver tu IP igual; si devuelve `6.6.6.6`, el valor está muy alto: bajarlo ya. B es la que importa.

**Trampa local:** en macOS el bridge de Docker es privado, así que la sonda B contra `localhost:3000` devuelve `6.6.6.6` y está bien. En local lo que discrimina es `-H 'X-Forwarded-For: 1.1.1.1, 2.2.2.2'`: con hops=1 debe dar `2.2.2.2`; si da `1.1.1.1`, el valor efectivo es `true` (emergencia).

Comandos, diagrama completo, verificación de iptables y deuda conocida: `references/topologia-y-migracion.md` (leer bajo demanda).

## Reglas de código

**Nunca leas `X-Forwarded-For` a mano.** Es una cabecera que escribe el cliente; leerla
directo es el agujero, no la solución. Fuente única de verdad:

```ts
import { extractClientIp, extractClientIpOptional } from '@common/utils/client-ip.util';

const ip = extractClientIp(req);            // 'unknown' si no se puede resolver
const ip = extractClientIpOptional(req);    // undefined si no se puede resolver
```

Ambas leen `req.ip`, que sólo es confiable porque `main.ts` configuró el predicado. Son
inseparables: una sin la otra no sirve.

**Llaveá con `bucketHash()` lo que sea PII.** Redis es texto plano para cualquiera con
acceso al contenedor; `KEYS rl:login:*` no debe ser un censo de usuarios.

## Archivos

| Qué | Dónde |
| --- | --- |
| Predicado, `isPrivateAddress`, `extractClientIp`, `bucketHash` | `apps/backend/src/common/utils/client-ip.util.ts` |
| Tests (incluida la reproducción de la falsificación vía `proxy-addr` real) | `apps/backend/src/common/utils/client-ip.util.spec.ts` |
| Configuración de `trust proxy` + sonda `/api/health` | `apps/backend/src/main.ts` |
| Cubetas compuestas del rate limit | `apps/backend/src/common/middleware/rate-limit.middleware.ts` |
| Tracker del throttler global | `apps/backend/src/common/guards/vendix-throttler.guard.ts` |
| Inyección de `TRUST_PROXY_HOPS` al contenedor API | `.github/workflows/deploy-backend-ec2.yml` (sólo `start_api`, el worker no sirve HTTP) |
| Valor en producción | Secrets Manager `vendix/production/app` |
| Valor local | `docker-compose.yml` (`TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-1}`) |

## Skills relacionados

- `vendix-redis-quota` — patrón INCR + EXPIRE que usan las cubetas.
- `vendix-cloud-operations` — SSH y AWS CLI para inspeccionar la topología real.
- `vendix-backend-auth` — guards y su orden de ejecución (por qué el throttler no puede
  llavear por `user.id`).
