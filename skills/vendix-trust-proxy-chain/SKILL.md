---
name: vendix-trust-proxy-chain
description: >
  Cadena de proxies de confianza y resolución de la IP real del cliente (`req.ip`) para el
  rate limit, la auditoría y cualquier regla por IP. Cubre `TRUST_PROXY_HOPS`, el predicado
  `createTrustProxyPredicate`, la topología verificada de producción, y la ruta de migración
  para meter un gateway/CDN delante del backend sin abrir un bypass del rate limit.
  Trigger: Cuando se agrega o quita un proxy, gateway, CDN, ALB o WAF delante del backend;
  cuando se cambia `TRUST_PROXY_HOPS`; cuando el rate limit bloquea a todos a la vez o no
  bloquea a nadie; o cuando se lee la IP del cliente en cualquier parte del código.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
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

> **Ante la duda, quedate corto.** Un número bajo se nota el mismo día; uno alto no se nota
> nunca. El apagón global que originó este skill fue el caso "muy bajo" (sin `trust proxy`
> del todo) y se detectó en horas. El caso "muy alto" no se habría detectado.

## Por qué un predicado y no un número

`main.ts` NO pasa el número a Express:

```ts
app.getHttpAdapter().getInstance().set('trust proxy', createTrustProxyPredicate(trustProxyHops));
```

Tres valores posibles, dos malos:

- **`true`** — Express toma el PRIMER elemento de `X-Forwarded-For`, que es exactamente el
  que escribe el cliente. Falsificación trivial. Nunca.
- **`N` (número pelado)** — confía en los N saltos más cercanos *incondicionalmente*. El
  problema: **una conexión directa también es el salto 0**. El contenedor publica
  `-p 3000:3000` y los security groups abren el puerto a `0.0.0.0/0`, así que cualquiera
  le habla al backend saltándose nginx, y su XFF se acepta como si viniera del proxy.
  Reproducido: `curl -H 'X-Forwarded-For: 6.6.6.6' http://localhost:3000/api/health`
  devolvía `client_ip: 6.6.6.6`.
- **Predicado** — `(addr, hop) => hop === 0 ? isPrivateAddress(addr) : hop < hops`.
  El salto 0 se confía **sólo si viene de una dirección privada**, o sea de un proxy tuyo
  en la red interna. Un golpe directo desde internet es salto 0 público ⇒ no se confía ⇒
  `proxy-addr` se queda con la IP real del atacante e ignora la cabecera.

### El límite del predicado (leer antes de meter un gateway)

El predicado **sólo protege el salto 0**. A partir del salto 1 decide por conteo, y por
conteo **una entrada legítima del gateway y una entrada falsificada son indistinguibles**.
Por eso el conteo tiene que ser exacto: es la única defensa que queda ahí.

Si algún día necesitás más margen, la solución no es tocar el número sino confiar por
**dirección** — los rangos de egreso conocidos del gateway — dentro de
`createTrustProxyPredicate`. Ese es el punto de extensión previsto.

## Topología de producción (verificada 2026-09-01)

```
navegador ──HTTPS──> api.vendix.online (32.195.142.115 = EIP del EC2)
                       └─> nginx en el HOST (systemd, /etc/nginx/conf.d/vendix.conf)
                             proxy_pass http://127.0.0.1:3000
                             X-Forwarded-For $proxy_add_x_forwarded_for   ← AÑADE
                             └─> contenedor vendix-backend (0.0.0.0:3000->3000)
                                   peer visto = gateway del bridge Docker (privado)
```

**Un solo proxy propio ⇒ `TRUST_PROXY_HOPS=1`.**

CloudFront (`E1I27OYFJX7VYJ`, alias `vendix.online` y `*.vendix.online`) **NO está delante
de la API**, aunque su origen se llame `api.vendix.online`:

- Route53 tiene un registro **A explícito** `api.vendix.online → 32.195.142.115`, que gana
  sobre el comodín `*.vendix.online → CloudFront`.
- El frontend llama `https://api.vendix.online/api` directo (`environment.ts`).
- CloudFront sólo enruta 4 rutas al origen backend: `sitemap.xml`, `robots.txt`,
  `manifest.webmanifest`, `pwa/*`. **Ninguna tiene rate limit.**

> Una distribución que existe pero no está en DNS recibe cero tráfico. **El DNS es la
> autoridad sobre qué camino recorre el tráfico, no el diagrama ni la consola.**

## Ruta de migración: meter un gateway delante del backend

Éste es el procedimiento cuando agregues un API Gateway, ALB, WAF o CDN.

### El orden importa, y sólo hay un orden seguro

Hay dos ventanas posibles durante la migración. Una es aceptable, la otra no:

| Orden | Ventana que se abre | ¿Aceptable? |
| --- | --- | --- |
| Subir `hops` **primero**, gateway después | El conteo declara un proxy que todavía no existe ⇒ **falsificación activa** | **NO. Nunca.** |
| Gateway **primero**, subir `hops` después | `req.ip` es la IP de egreso del gateway ⇒ todos comparten cubeta (degradado) | **Sí.** Ruidoso y reversible. |

**Siempre: gateway primero, `hops` después.** Se acepta la ventana degradada, jamás la de
falsificación.

### Pasos

**1. Contá los saltos desde el DNS, no desde el diagrama.**

```bash
dig +short api.vendix.online        # ¿A la EIP, o a un CDN/ALB?
```

Un registro A a tu EIP significa que no hay nada delante, sin importar qué
distribuciones/gateways existan en la cuenta.

**2. Verificá si cada salto AÑADE o REEMPLAZA el `X-Forwarded-For`.**

Esto cambia el número. nginx con `$proxy_add_x_forwarded_for` **añade** (el XFF del cliente
sobrevive y se le concatena la IP real). Un gateway que **reemplaza** el XFF con la IP del
cliente **no suma un salto** — el conteo se queda como estaba por más cajas que agregues.

```bash
# nginx de prod
ssh -i keys/vendix-production-key.pem ec2-user@<EIP> \
  'sudo grep -rn "X-Forwarded-For" /etc/nginx/conf.d/'
```

**3. Desplegá el gateway SIN tocar `TRUST_PROXY_HOPS`.**

Verificá con la sonda (abajo) que `client_ip` ahora muestra la IP de egreso del gateway.
Eso confirma que el gateway está de verdad en el camino. Es el estado degradado esperado:
seguro, visible, temporal.

**4. Recién ahí subí el valor** en Secrets Manager y redesplegá:

```bash
CUR=$(aws secretsmanager get-secret-value --secret-id vendix/production/app \
      --query SecretString --output text)
NEW=$(printf '%s' "$CUR" | python3 -c "
import sys, json
d = json.load(sys.stdin); before = len(d)
d['TRUST_PROXY_HOPS'] = '2'
assert len(d) == before, 'clave nueva inesperada'
sys.stdout.write(json.dumps(d))")
aws secretsmanager put-secret-value --secret-id vendix/production/app --secret-string "$NEW"
```

> `put-secret-value` **reemplaza el JSON entero**. Siempre leer, fusionar en memoria y
> verificar el conteo de claves. La versión anterior queda como `AWSPREVIOUS` (rollback).

**5. Corré la sonda de dos curls y no des el paso por hecho hasta que pase.**

### La sonda de dos curls (obligatoria tras cualquier cambio de topología)

`/api/health` expone `client_ip` y `trust_proxy_hops` justamente para esto.

```bash
MI_IP=$(curl -s https://api.ipify.org)

# A — camino legítimo: debe devolver TU IP pública real
curl -s https://api.vendix.online/api/health | python3 -c "import sys,json; print(json.load(sys.stdin).get('client_ip'))"
# esperado: $MI_IP   → si devuelve la IP de nginx/gateway, el número está MUY BAJO

# B — intento de falsificación por el camino legítimo: debe devolver TU IP igual
curl -s -H 'X-Forwarded-For: 6.6.6.6' https://api.vendix.online/api/health | python3 -c "import sys,json; print(json.load(sys.stdin).get('client_ip'))"
# esperado: $MI_IP   → si devuelve 6.6.6.6, el número está MUY ALTO. Bajalo YA.
```

**B es la que importa.** A puede pasar con un valor demasiado alto; sólo B lo delata.

### En local la sonda B NO significa lo mismo (trampa)

Contra el backend de desarrollo, `curl -H 'X-Forwarded-For: 6.6.6.6' localhost:3000/api/health`
**devuelve `6.6.6.6`, y eso está bien**. En macOS (Docker Desktop / Colima) todo lo que sale
del host llega al contenedor SNAT'd por el gateway del bridge (`172.18.0.1`), que es una
dirección **privada** — o sea, ocupa exactamente la posición de nginx. El predicado confía en
ese salto 0 y camina la cadena, como debe.

Consecuencia: **el golpe directo de producción (salto 0 público) no se puede reproducir desde
el host en macOS.** No lo intentes y no leas ese `6.6.6.6` como un agujero.

Lo que SÍ discrimina en local es una cadena de **dos** entradas:

```bash
curl -s -H 'X-Forwarded-For: 1.1.1.1, 2.2.2.2' localhost:3000/api/health \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('client_ip'))"
# esperado con hops=1: 2.2.2.2  (la ÚLTIMA entrada)
# si devuelve 1.1.1.1 → el valor efectivo es `true`: el cliente manda. Emergencia.
```

Las dos garantías del caso directo de producción se verifican por otro lado:

1. **Docker preserva la IP de origen en el puerto publicado** — regla `DNAT ... 0.0.0.0/0
   → 172.18.0.3:3000` en la EC2; los `MASQUERADE` cubren sólo el tráfico *saliente* de las
   subredes Docker. Un atacante externo llega al contenedor con su IP pública real.
   ```bash
   ssh -i keys/vendix-production-key.pem ec2-user@<EIP> \
     'sudo iptables -t nat -L DOCKER -n | grep 3000; sudo iptables -t nat -L POSTROUTING -n'
   ```
2. **El predicado rechaza un salto 0 público** — cubierto por `client-ip.util.spec.ts` contra
   la librería `proxy-addr` real, la misma que usa Express por dentro.

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

## Deuda conocida

- **Puerto 3000 abierto a `0.0.0.0/0`** en `vendix-ec2-sg` (`sg-02be590feb1192274`) y
  `vendix-ec2-backend` (`sg-042c482ccb85b3d80`). El predicado hace que un golpe directo se
  cuente contra la IP real del atacante, así que el rate limit funciona — pero el puerto
  abierto igual saltea TLS, nginx y cualquier WAF. Cerrarlo es defensa en profundidad y no
  rompe nada: nginx entra por `127.0.0.1:3000`, no por la IP pública.
- El predicado decide por **conteo** a partir del salto 1. Confiar por **dirección** (rangos
  de egreso del gateway) es la evolución natural cuando haya un gateway real.

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
