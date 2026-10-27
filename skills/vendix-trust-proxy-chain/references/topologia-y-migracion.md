# Trust proxy: topología, migración a gateway y sondas

Detalle del skill `vendix-trust-proxy-chain`. Leer bajo demanda.

## El límite del predicado (leer antes de meter un gateway)

El predicado **sólo protege el salto 0**. A partir del salto 1 decide por conteo, y por
conteo **una entrada legítima del gateway y una entrada falsificada son indistinguibles**.
Por eso el conteo tiene que ser exacto: es la única defensa que queda ahí.

Si algún día necesitás más margen, la solución no es tocar el número sino confiar por
**dirección** — los rangos de egreso conocidos del gateway — dentro de
`createTrustProxyPredicate`. Ese es el punto de extensión previsto.

## Topología de producción (verificada 2026-09-01; blue/green documentado 2026-10-14)

```
navegador ──HTTPS──> api.vendix.online (32.195.142.115 = EIP del EC2)
                       └─> nginx en el HOST (systemd, /etc/nginx/conf.d/vendix.conf)
                             proxy_pass http://vendix_api;
                             upstream vendix_api { server 127.0.0.1:<3001|3002>; }
                               (/etc/nginx/conf.d/vendix-upstream.conf)
                             X-Forwarded-For $proxy_add_x_forwarded_for   ← AÑADE
                             └─> contenedor vendix-backend-blue (127.0.0.1:3001->3000)
                                 o vendix-backend-green (127.0.0.1:3002->3000), solo uno activo
                                   peer visto = gateway del bridge Docker (privado)
```

El puerto 3000 ya NO se publica en el host. El primer deploy tras el cambio aún puede
tener el legado `vendix-backend` en 3000 hasta que se retire.

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
     'sudo iptables -t nat -L DOCKER -n | grep -E "300[0-2]"; sudo iptables -t nat -L POSTROUTING -n'
   ```
2. **El predicado rechaza un salto 0 público** — cubierto por `client-ip.util.spec.ts` contra
   la librería `proxy-addr` real, la misma que usa Express por dentro.

## Deuda conocida

- ~~Puerto 3000 abierto a `0.0.0.0/0`~~ **Resuelta con el deploy blue/green** (2026-10-14):
  los slots publican sólo en `127.0.0.1:3001/3002` y el 3000 se cierra en los security groups
  (security groups `vendix-ec2-sg` y `vendix-ec2-backend`). Verificar tras el primer deploy que el legado
  `vendix-backend` en 3000 ya no existe y que la regla del SG fue retirada. El predicado
  sigue siendo la defensa del salto 0.
- El predicado decide por **conteo** a partir del salto 1. Confiar por **dirección** (rangos
  de egreso del gateway) es la evolución natural cuando haya un gateway real.

