# Certificación T53 · Lambda aislada de análisis de Vex (F9)

| | |
| --- | --- |
| **Resultado vigente (corrida 3)** | **NO CERTIFICADA.** Punto 1 pasa. Los puntos 2, 3 y 4 no quedan certificados por comprobaciones incompletas; además, el handler falla en preflight con `ANALYSIS_RUNTIME: sandbox error: OSError`. El punto 5 pasa. El punto 6 no se fija. |
| Fecha | 2026-11-22, 22:00-22:20 UTC (17:00-17:20 Bogotá) |
| Cuenta / región | `us-east-1` (perfil `default`; autorización vigente del dueño) |
| Función | `vendix-vex-analysis-sandbox` |
| Imagen desplegada | `vendix-vex-analysis-runtime@sha256:2535679ca19143d876a3e3a15b62d617a59d086dc71e07077cd355ca9502bfc9` (tag inmutable `rt-a6e1eade84bb`, `linux/arm64`) |
| Runtime digest | `sha256:a6e1eade84bb2ee29b6793c83fa33839f8684f85bc68b3aea4abdcdb80b05c77` (`./runtime-digest.sh` sobre `8e39339b6`) |
| Código medido | `8e39339b6`, incluye el fix `28ac85534` que sella `RLIMIT_NOFILE=(0,0)` antes del código invitado |
| CodeSha256 / digest ECR | `2535679ca19143d876a3e3a15b62d617a59d086dc71e07077cd355ca9502bfc9` (coinciden; `ImageUri` fijado por digest; actualización completada 21:59:20Z) |
| Base | `public.ecr.aws/lambda/python:3.12@sha256:ed196260cbf6f74e3f64dd141ebe2401d78a15e6355925da98a3d3c3b4d35c6a` (sin cambios) |

La corrida 1 (digest `c5aca9a0…`, runtime `0a0ed8a9…`) queda abajo como historial, sin cambios.

## Corrida 3 · resultados T53 sobre el digest desplegado

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Egreso cero | **PASA.** La VPC tiene DNS y hostnames deshabilitados; el SG no tiene ingress y solo permite el placeholder `127.0.0.1/32`; las tablas solo tienen rutas `local`; IGW, NAT y endpoints: 0. La syscall `libc.socket(AF_INET, SOCK_STREAM, 0)` desde el invitado devuelve `EMFILE` (24) con `RLIMIT_NOFILE=(0,0)`, antes de poder conectar a `169.254.100.1:9001`. La sonda HTTP `/runtime/invocation/next` y el robo de `nonce` no pudieron abrir un socket; no se observó ninguna conexión ni intercepción. |
| 2 | FS, `/proc` y secretos | **FALLA / INCOMPLETO.** Sí se midió: `/proc/self/environ` y `/proc/<ppid>/{environ,mem,maps,fd}` pertenecen a UID 0; las lecturas devuelven `EMFILE`; `process_vm_readv` y `ptrace` devuelven `EPERM`; el entorno del hijo no contiene claves `AWS_*` ni `LAMBDA_*`. No se pudo completar la prueba de escritura fuera de `/tmp` ni symlink/FIFO de `result.json`: al intentarlas después, el handler rechazó la invocación durante el preflight, antes de ejecutar al invitado. |
| 3 | Límites de recursos | **FALLA.** La sonda de doble `fork` + `setsid` no llegó a ejecutar. Tras la corrida 100×3, la invocación del probe y al menos cuatro invocaciones posteriores devolvieron `ANALYSIS_RUNTIME`, `sandbox error: OSError`, `duration_ms: 0`. El código del handler emite este error cuando falla `_harden_parent_dumpable()` o `_reap_strays()` antes de lanzar el proceso hijo; las respuestas y el log tail no permiten distinguir cuál. Por tanto no se certifican los límites ni la limpieza de daemon en esta corrida. |
| 4 | Multi-tenant (100 × 3 tiendas) | **FALLA / INCOMPLETO.** Las 100 invocaciones secuenciales respondieron `status: ok`, digest correcto, marcador propio, número de filas y suma esperados; fallos de cruce: 0. El `handler_pid` reportado fue `2` en las 100. No se registró un `boot_id` u otro identificador único del entorno caliente; el PID `2` por sí solo no demuestra que Lambda no reciclara el entorno. Por criterio estricto, el requisito de 100 ejecuciones verificadas en un único entorno caliente queda sin certificar. |
| 5 | Política IAM | **PASA.** La función está en la VPC dedicada; rol de ejecución confiado solo a Lambda, sin políticas administradas, con única inline `VpcEniOnly` y las cinco acciones ENI. Sin policy resource, Function URL, alias, event source mapping, layer, variable de entorno ni log group. VPC DNS `false/false`, SG sin ingress y egress solo loopback, 2 tablas con rutas `local`, 0 IGW/NAT/endpoints, subnets privadas. La simulación de `backend-invoke-policy.json` permite `lambda:InvokeFunction` al ARN de esta función y deniega `UpdateFunctionCode` y `InvokeFunctionUrl`; no se inspeccionó ni modificó el rol de producción del backend. |
| 6 | Firma y digest | **FALLA (no se fija).** ECR tag inmutable, `CodeSha256`, digest ECR y `ResolvedImageUri` coinciden; las 100 respuestas T53 medidas reportan el runtime digest del repo. Como los puntos 2–4 no pasan la certificación, `AI_ANALYSIS_CERTIFIED_DIGEST` queda **sin fijar**. |

### Evidencia y límites de la corrida 3

- Con Colima apagado, `./runtime-digest.sh` dio `sha256:a6e1eade…b05c77`, igual al digest asociado al tag local `rt-a6e1eade84bb`; la imagen existente es `linux/arm64` y no se reconstruyó. El tag ECR es `rt-a6e1eade84bb`, inmutable, con digest `sha256:2535679c…50bfc9`. La Lambda quedó `Active` / `LastUpdateStatus=Successful`, fijada a ese mismo digest y con `LastModified=2026-11-22T21:59:20Z`.
- Calentamiento: análisis trivial devuelve `status: ok`, total `6`, y el runtime digest esperado. Prueba de Runtime API: el import de `socket` falla cerrado; la llamada directa a `libc.socket` devuelve `-1/EMFILE`. No se llegó a enviar HTTP a `/2018-06-01/runtime/invocation/next` ni a observar un `nonce`.
- `/proc`: UID propietario `0` para los ficheros de entorno del invitado y padre; lecturas bloqueadas con `OSError:24`; `process_vm_readv` y `ptrace` devuelven `-1/EPERM`; lista de variables AWS/Lambda del hijo vacía.
- Multi-tenant: llamadas 1–100 alternaron A/B/C con marcadores únicos, respectivamente 40/55/70 filas por tienda; todas calcularon sumas esperadas y devolvieron solo su propio marcador. Las 100 respuestas conservaron `sha256:a6e1eade…b05c77`; se observó `handler_pid=2` en todas, pero no se midió un identificador único del entorno.
- Fallo de preflight reproducido en tres invocaciones posteriores, incluida una tras esperar el posible recambio del entorno: `ANALYSIS_RUNTIME: sandbox error: OSError`, `duration_ms=0`; Lambda respondió HTTP 200 sin `FunctionError`. No se pudo determinar cuál de las dos comprobaciones de preflight (`_harden_parent_dumpable` / `_reap_strays`) lanzó la excepción. Ningún probe hostil se ejecutó en la Mac.
- Colima quedó apagado y se cerró la sesión Docker de ECR al terminar el push.

La corrida 2 queda a continuación como historial; sus resultados no se transfieren a este digest.

## Historia de usuario

**Como** dueño de Vendix en producción, **quiero** que el análisis en Python de Vex corra en una Lambda aislada y certificada **para** encender `AI_ANALYSIS_SANDBOX_ENABLED` sin que el código generado pueda salir a internet, leer credenciales de AWS ni ver o alterar datos de otra tienda.

**Pasos para probarlo** (consola del operador; el código hostil solo corre dentro de Lambda):

1. Invocar la función con un análisis trivial (sumar 1, 2 y 3) y ver la respuesta.
2. Invocar programas hostiles: salir a internet/DNS/IMDS/VPC de producción, hablar con la Runtime API de Lambda, escribir fuera de `/tmp`, leer `/proc` del padre, agotar memoria/CPU/procesos/disco, dejar un daemon vivo.
3. Invocar 100 veces alternando datos marcados de 3 tiendas sobre el mismo entorno caliente y buscar marcadores ajenos; además, que un invitado de la tienda C intente quedarse con la invocación siguiente de la tienda A.
4. Revisar en IAM los permisos del rol de la función y de la política del backend.
5. Comparar el digest de la imagen desplegada con el que reporta la función y el que calcula el repo.

**Criterios de aceptación observables:**

- El análisis trivial responde `status: ok` con su tabla.
- Cada programa hostil termina en un código de error acotado o con la conexión bloqueada, sin procesos ni archivos residuales.
- Ninguna tienda ve ni recibe datos o respuestas de otra.
- Los 6 puntos pasan sobre **el mismo digest desplegado**.

**Lo que se observó:** el análisis trivial responde `status: ok` con `total = 6` en ~2,1 s, y los arreglos de la corrida 1 funcionan (padre ilegible, daemon eliminado, 100/100 del checklist). Pero el invitado de la tienda C, abriendo un socket a `169.254.100.1:9001`, falsificó su propia respuesta, recibió la invocación siguiente de la tienda A con todos sus datos, le respondió a A con un resultado inventado y entregó el marcador de A en la invocación siguiente de C. Las tres respuestas traen un sobre válido (`execution_id`, `nonce`, `runtime_digest`): el backend las aceptaría.

## Corrida 2 (historial) · resultado por punto, digest desplegado `35346aa5…` / runtime `3a4f233b…`

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Egreso cero | **FALLA.** Toda la red sigue bloqueada (DNS, internet, IMDS, credenciales, VPC y EC2/RDS de producción, raw/`AF_PACKET`), pero la Runtime API de Lambda (`169.254.100.1:9001`) responde al invitado y es explotable (hallazgo bloqueante 3) |
| 2 | FS, `/proc` y secretos | **PASA.** Escritura fuera de `/tmp` → `EROFS`; intérprete `0711`; `/proc/<ppid>/{environ,maps,mem,fd}` de root y denegados; `process_vm_readv` y `ptrace` → `EPERM`; entorno del hijo sin `AWS_*`; symlink y FIFO en `result.json` rechazados. El `nonce` del protocolo sí queda expuesto, pero por la Runtime API (punto 1) |
| 3 | Límites de recursos | **PASA.** 13 casos hostiles, daemon con doble `fork` + `setsid` y matar al padre: códigos acotados, sin procesos ni archivos residuales, siempre en el mismo entorno |
| 4 | Multi-tenant (100 × 3 tiendas) | **FALLA.** El checklist de residuos da 100/100 en los 14 controles, pero la sonda R2 demuestra intercepción entre tiendas: A recibe la respuesta del invitado de C y C recibe el marcador de A |
| 5 | Política IAM | **PASA.** Rol solo ENI; sin política de recurso, URL, alias, mapeos ni logs; la política del backend solo permite `InvokeFunction` sobre este ARN y **no está aplicada** |
| 6 | Firma y digest | **NO SE FIJA.** La identidad es trazable (CodeSha256 = digest ECR = `ImageUri` fijado; `runtime_digest` de todas las respuestas del handler, ~170 invocaciones, = `runtime-digest.sh` de `e27f50b5b`), pero fallan 1 y 4 |

## Hallazgo bloqueante 3 · el invitado secuestra la Runtime API de Lambda

La Runtime API vive dentro de la microVM (`169.254.100.1:9001`): ningún security group, ruta ni NACL la filtra y no pide autenticación. El handler ya no deja leer su memoria ni su entorno, pero el invitado no lo necesita: le pide el evento directamente a Lambda.

**Sonda R1** (una invocación; el invitado hace `GET /2018-06-01/runtime/invocation/next` mientras su propia invocación sigue en curso):

```text
next_status        HTTP/1.1 200 OK
request_id         a3d7af89-df37-443a-9427-bdb086ba0d1a   = START RequestId del log de la invocación
event_execution_id t53-rapi-r1-766b980ff18a               = el enviado
event_nonce        1b57fc7e…77ae                          = el enviado (64 hex)
body               4750 bytes JSON, con source e inputs
```

Lambda le devuelve al invitado el evento en curso completo. El `nonce`, que debía demostrar que la respuesta viene del handler, deja de proteger nada.

**Sonda R2** (tres invocaciones seguidas en el entorno `70a2903a`; el código hostil solo corre en Lambda):

```text
C1 (atacante, tienda C)  2,7 s  respuesta: "FORGED-BY-C"   sobre válido, duration_ms 1
  invitado: GET /next -> evento propio; POST /invocation/<id>/response -> 202 Accepted; GET /next otra vez (vivo)
A  (víctima, tienda A)   0,7 s  respuesta: "HIJACKED-BY-C" sobre válido, duration_ms 1   <- A nunca ejecutó su análisis
  invitado de C: recibe el evento de A con sus 40 filas (TENANT-A-4f35ed7437004528); POST response -> 202
C2 (atacante, tienda C)  1,1 s  respuesta: stolen = TENANT-A-4f35ed7437004528, sobre válido
después                         init solo, /tmp limpio, runtime reiniciado (pid 5, mismo boot_id)
```

Al recibir la respuesta falsificada, Lambda da por terminada la invocación de C y ve el entorno libre, porque el invitado sigue esperando en `/next`. La siguiente invocación que Lambda envía a ese entorno (con concurrencia reservada 3 y varias tiendas activas, la de cualquier tienda) llega al invitado, no al handler. El invitado vive hasta 23 s, tiempo de sobra para capturar varias.

**Impacto:** un invitado malicioso o inducido por prompt lee completos los datos de otra tienda, le responde con resultados inventados que su agente tomará como verdaderos y se lleva esos datos en una invocación posterior propia. Las 100 ejecuciones del checklist no lo detectan porque buscan residuos después de cada corrida, no una intercepción activa durante ella.

**Arreglo:** no se aplicó en esta corrida (prohibido reconstruir). Hace falta que el invitado no pueda abrir conexiones hacia la Runtime API antes de ejecutar su código, construir una imagen nueva, desplegarla y repetir T53 completa con R1 y R2 como casos obligatorios de los puntos 1 y 4. Durante esta corrida otra sesión preparó ese arreglo (sellar `RLIMIT_NOFILE` antes del código del invitado) y lo dejó en el commit local `28ac85534`, sin publicar al cierre. No forma parte de lo medido aquí: su runtime digest es `sha256:a6e1eade84bb2ee29b6793c83fa33839f8684f85bc68b3aea4abdcdb80b05c77`, no está construido ni desplegado y exige su propia T53.

## Evidencia por punto (corrida 2)

Arnés: `aws lambda invoke` con `AWS_MAX_ATTEMPTS=1` (un intento, sin reintentos) y `--log-type Tail` desde la Mac del operador; ningún programa hostil se ejecutó en la Mac. Cada respuesta se validó contra el sobre (`vendix.analysis/v1`, `execution_id`, `nonce` y `runtime_digest` esperados): **todas las respuestas del handler pasan**, y también las falsificadas por R2. Calentamiento: 3 invocaciones triviales, `status: ok`, `total = 6`, 2122-2159 ms. Las invocaciones secuenciales caen en el mismo entorno caliente (`boot_id 70a2903a`, runtime pid 2 / ppid 0); una sonda aislada cayó en un segundo entorno (`828f582a`), también limpio.

### 1 · Egreso cero

| Destino | Resultado |
| --- | --- |
| `resolv.conf` del invitado | `nameserver 169.254.100.5`, `timeout:2 attempts:5` |
| DNS: `example.com`, subdominio aleatorio, `sts.amazonaws.com`, `lambda.us-east-1.amazonaws.com`, endpoint RDS de producción | BLOCKED (sin respuesta en 12 s) |
| UDP/53 a `10.77.0.2`, `169.254.169.253`, `169.254.100.5`, `8.8.8.8`, `1.1.1.1`, `172.31.0.2` | BLOCKED (timeout) |
| TCP a `1.1.1.1` (53/80/443) y `8.8.8.8` (53/443); `https://example.com/` | BLOCKED (timeout) |
| IPv6 `2606:4700:4700::1111:443` | BLOCKED (`EADDRNOTAVAIL`) |
| IMDS `169.254.169.254` (TCP, HTTP v1, token v2), credenciales `169.254.170.2` | BLOCKED (`ECONNREFUSED`) |
| NTP `169.254.169.123:123` | BLOCKED (`EPERM`) |
| EC2 de producción `10.0.10.80` (22/80/443/3000), RDS `10.0.20.75:5432`, IP pública de la EC2 `:443` | BLOCKED (timeout) |
| `SOCK_RAW` ICMP, `AF_PACKET` | BLOCKED (`EPERM`) |
| TCP `169.254.100.5:53` (proxy DNS local) | conecta, no responde |
| **TCP `169.254.100.1:9001` (Runtime API)** | **abierto y explotable: R1 y R2** |

### 2 · Sistema de archivos, `/proc` y secretos

| Sonda | Resultado |
| --- | --- |
| Crear en `/var/task`, `/var/runtime`, `/opt`, `/etc`, `site-packages`, `/usr/lib`, `/`, `/var/tmp`, `/run`, `/home`, `/var/lang/bin` | `EROFS` (`/root`: `EACCES`; `/dev/shm` no existe) |
| Abrir para escritura `handler.py`, el intérprete; `chmod` del handler | `EROFS` |
| Abrir para escritura `/proc/sys/kernel/core_pattern` | `EACCES` |
| Crear en el directorio propio de `/tmp` (control) | permitido |
| Modo del intérprete `/var/lang/bin/python3.12` | `0711` |
| Entorno del hijo | `HOME, LANG, MKL/OMP/OPENBLAS_NUM_THREADS, PATH, PYTHONDONTWRITEBYTECODE, TMPDIR`; sin `AWS_*` ni `LAMBDA_*` |
| Identidad del hijo | uid/gid 993/990, `CapEff/CapPrm/CapBnd = 0`, `NoNewPrivs 1`, `Seccomp 2` (6 filtros) |
| Dueño de `/proc/self/environ` y de `/proc/<ppid>/environ` | uid 0 (hijo y padre no-dumpables) |
| `/proc/<ppid>/environ`, `maps` (`EACCES`), `mem`, `fd` (`PermissionError`), `/proc/1/environ` | denegados |
| `process_vm_readv(ppid)` / `ptrace(PTRACE_ATTACH, ppid)` | `EPERM` / `EPERM` |
| Otro `/proc/*/environ` con el nombre `AWS_SECRET_ACCESS_KEY` | ninguno |
| `result.json` como symlink / como FIFO | `ANALYSIS_OUTPUT "result file cannot be opened safely"` / `"result file is not a regular file"` |
| Logs | el grupo `/aws/lambda/vendix-vex-analysis-sandbox` no existe y el rol no puede crearlo; el `Tail` solo trae `START/END/REPORT` |

### 3 · Límites de recursos

Cada caso va entre una sonda previa y una posterior; las tres cayeron en el mismo entorno (`70a2903a`) y el salto de PID entre ellas confirma que el caso corrió allí.

| Caso hostil | Respuesta | Tiempo del handler (s) | Después: procesos / `/tmp` / libre |
| --- | --- | --- | --- |
| `bytearray` de 2 GiB | `ANALYSIS_MEMORY` | 2,2 | solo `init` / vacío / 513 MB |
| Lista que crece sin fin | `ANALYSIS_MEMORY` | 2,9 | ídem |
| numpy 30 000 × 30 000 | `ANALYSIS_MEMORY` | 2,2 | ídem |
| Bucle infinito de CPU | `ANALYSIS_TIMEOUT` (pared) | **23,0** | ídem |
| `sleep(120)` | `ANALYSIS_TIMEOUT` (pared) | **23,0** | ídem |
| Fork bomb (los hijos también hacen `fork`) | `ok`: 32 `fork` del padre, 64 procesos visibles, tope `RLIMIT_NPROC` (`EAGAIN`) | 2,8 | ídem (PID 151 → 219) |
| Thread bomb | `ok`: 20 hilos, `RuntimeError` | 2,2 | ídem |
| Inundación de stdout | `ANALYSIS_RUNTIME "OSError: [Errno 27] File too large"` | 2,1 | ídem |
| Inundación de stderr con rutas | `ANALYSIS_RUNTIME` (mismo mensaje, sin rutas) | 2,2 | ídem |
| Archivo grande en `/tmp` | `ANALYSIS_RUNTIME "File too large"` | 2,2 | ídem |
| Llenar `/tmp` con muchos archivos | `ANALYSIS_RUNTIME "child exited without a result"` | 3,6 | ídem |
| Salida de más de 256 KB | `ANALYSIS_OUTPUT "output exceeds 262144 bytes"` | 2,2 | ídem |
| `setsid()` en el hijo | `ANALYSIS_RUNTIME "PermissionError"` | 2,2 | ídem |
| Matar al padre | `FunctionError: Unhandled` `Runtime.ExitError` (falla cerrado) | 2,7 (cliente) | solo `init` / vacío; runtime reiniciado (pid 5, mismo `boot_id`) |

Daemon con doble `fork` + `setsid` (el caso que la corrida 1 no pasó):

```text
spawn_daemon        ok   planted; control: ALIVE {"pid": 307, "sid": 306, "stolen": []}
victim_tenant_A     ok   other_procs = 1:init:uid=0:ppid=0; daemon = NO_DAEMON ConnectionRefusedError; total 2380
attacker            ok   NO_DAEMON ConnectionRefusedError; /tmp vacío
after               ok   NO_DAEMON; solo init
```

Los tiempos de espera ahora responden a 23,0 s (`wall_ms` menos la reserva de 2 s), dentro del presupuesto de 25 s del backend: queda resuelto el hallazgo operativo 2 de la corrida 1.

### 4 · Aislamiento multi-tenant

100 invocaciones consecutivas, A → B → C (34/33/33), con 40, 55 y 70 filas marcadas. Las 100 cayeron en el entorno `70a2903a/ppid=2`. Duración por análisis: 2631-2909 ms (mediana 2720 ms). Además del checklist de la corrida 1, **cada ejecución deja un daemon con doble `fork` + `setsid` y un archivo en la raíz de `/tmp`** con su marcador, y la siguiente los busca.

| Comprobación por ejecución | Pasan |
| --- | --- |
| Sobre del protocolo válido / `status: ok` | 100/100 / 100/100 |
| La tienda ve su propio marcador y la respuesta solo contiene el propio | 100/100 |
| Ningún marcador ajeno en `/tmp` (lectura de todos sus archivos) | 100/100 |
| `/tmp` solo con `in/sales.json`, `limits.json`, `source.py` | 100/100 |
| Ninguna variable global de una ejecución anterior | 100/100 |
| Total calculado correcto (A 2380, B 7535, C 17115) | 100/100 |
| Ningún marcador en el log de la invocación | 100/100 |
| Memoria del padre ilegible | 100/100 |
| Ningún archivo residual de la ejecución anterior | 100/100 |
| Ningún daemon de la ejecución anterior (control positivo: el plantado estaba vivo en su propia ejecución, 100/100) | 100/100 |
| Solo `init` visible además del propio proceso y el handler | 100/100 |

El arnés comparaba el total como entero y la tabla lo devuelve como texto; se re-evaluó desde las respuestas guardadas con los totales esperados (deterministas). **Este 100/100 no certifica el punto**: la sonda R2 (hallazgo bloqueante 3) demuestra la fuga entre tiendas sobre el mismo digest.

### 5 · Política IAM (digest desplegado)

```text
rol de ejecución   trust: lambda.amazonaws.com · sts:AssumeRole · sin permissions boundary
                   inline VpcEniOnly: ec2:CreateNetworkInterface, DescribeNetworkInterfaces,
                   DeleteNetworkInterface, AssignPrivateIpAddresses, UnassignPrivateIpAddresses
                   administradas: ninguna
lambda             get-policy ResourceNotFoundException · URLs 0 · alias 0 · versiones solo $LATEST
                   event source mappings 0 · variables de entorno ninguna · capas ninguna
log groups         ninguno
red                VPC con enableDnsSupport/Hostnames = false · rutas solo local (2 tablas)
                   IGW 0 · egress-only IGW 0 · NAT 0 · endpoints 0 · peering 0 · TGW 0
                   SG sin ingress; egress solo 127.0.0.1/32 tcp/1 · subredes sin IP pública
IaC                plantilla desplegada == template.json del repo · drift: IN_SYNC (0 recursos)
backend            política vendix-vex-analysis-invoke: NoSuchEntity (no aplicada)
```

`aws iam simulate-custom-policy` con `backend-invoke-policy.json` (ARN real):

| Acción | `vendix-vex-analysis-sandbox` | `vendix-production-alerts-telegram` | otra función del prefijo |
| --- | --- | --- | --- |
| `lambda:InvokeFunction` | **allowed** | implicitDeny | implicitDeny |
| `lambda:UpdateFunctionCode` | implicitDeny | implicitDeny | implicitDeny |
| `lambda:UpdateFunctionConfiguration` | implicitDeny | implicitDeny | implicitDeny |
| `lambda:InvokeFunctionUrl` | implicitDeny | implicitDeny | implicitDeny |

### 6 · Identidad del digest

| Fuente | Valor |
| --- | --- |
| `Configuration.CodeSha256` | `35346aa5de5f2bca9749525f31c00ba180571f22dd51ae533191bd95332c67a2` |
| Digest en ECR del tag `rt-3a4f233be693` (repositorio IMMUTABLE, scan on push, AES256) | `sha256:35346aa5…67a2` |
| `Code.ImageUri` / `ResolvedImageUri` / parámetro `ImageUri` del stack | `…/vendix-vex-analysis-runtime@sha256:35346aa5…67a2` (fijado por digest) |
| `runtime_digest` en todas las respuestas | `sha256:3a4f233be693ab7e00a02724b9db9fd619148b15ce485cfc7701b9ca8114168e` |
| `./runtime-digest.sh` sobre `e27f50b5b` (HEAD y `origin/feat/vex-plus-aws`) | `sha256:3a4f233be693ab7e00a02724b9db9fd619148b15ce485cfc7701b9ca8114168e` |

La cadena es trazable de punta a punta, pero el digest no se certifica: fallan los puntos 1 y 4.

## Hallazgos operativos (corrida 2, no bloquean por sí solos)

1. **Arranque en frío:** no se repitió; la primera invocación respondió en 2,2 s (la imagen ya estaba cargada por la corrida interrumpida).
2. **Matar al padre** reinicia el runtime dentro de la misma microVM (mismo `boot_id`, pid desde 5), no necesariamente un entorno nuevo; el `kill(-1)` previo a cada tienda cubre ese caso y la sonda siguiente lo confirma. La sonda R2 también provocó un reinicio del runtime.
3. **Escaneo de ECR de `rt-3a4f233be693`:** 4 HIGH (`CVE-2026-95520` y `CVE-2026-95521` en `rpm`/`rpm-libs 4.16.1.3`), 6 MEDIUM (`sqlite-libs 3.40.0`), 1 LOW. Vienen de la imagen base (los mismos conteos que `rt-0a0ed8a9655b`) y no forman parte de T53; conviene revisarlos al rehacer la imagen.
4. **Código posterior a lo medido:** durante la corrida otra sesión commiteó localmente `28ac85534` (`handler.py`, `runner.py`, `test_runner.py`, `README.md`). Lo medido es exactamente `e27f50b5b`; desde `28ac85534` el repo calcula otro runtime digest y la T53 de esta corrida no lo cubre.
5. **Recursos:** no se creó, modificó ni borró ningún recurso en esta corrida (solo invocaciones y lecturas; una detección de drift del stack). La imagen `rt-0a0ed8a9655b` de la corrida 1 sigue en ECR.

## Valores para el release (corrida 2)

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | sin definir o `false`. No hay digest certificado |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | `arn:aws:lambda:us-east-1:637423209959:function:vendix-vex-analysis-sandbox` |
| `AI_ANALYSIS_LAMBDA_REGION` | `us-east-1` |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:3a4f233be693ab7e00a02724b9db9fd619148b15ce485cfc7701b9ca8114168e` (desplegado, **no certificado**) |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | **NO SE FIJA.** T53 falla en los puntos 1 y 4. Sin este valor el backend mantiene la feature apagada |

La política del backend, el comando para adjuntarla y el costo estimado no cambian respecto de la corrida 1 (ver historial); la política sigue sin aplicarse.

## Para re-certificar

1. Impedir que el invitado alcance la Runtime API (`169.254.100.1:9001`) antes de ejecutar su código, con pruebas offline del bloqueo.
2. `./runtime-digest.sh` → nuevo `AI_ANALYSIS_RUNTIME_DIGEST`; construir `linux/arm64` y subir con tag inmutable `rt-<12 hex>`.
3. Actualizar el stack con `ImageUri=…@sha256:<digest ECR>` e invocar un análisis trivial para calentar la imagen.
4. Repetir los 6 puntos sobre ese digest, **con R1 y R2 como casos obligatorios** (un invitado que pide `/runtime/invocation/next`, falsifica su respuesta e intenta quedarse con la invocación de otra tienda) además del daemon, y fijar `AI_ANALYSIS_CERTIFIED_DIGEST` solo si todo pasa.

---

## Historial · corrida 1 (digest `c5aca9a0…`, runtime `0a0ed8a9…`)

Primera corrida del mismo día (13:28-14:10 Bogotá), sobre el código anterior a los arreglos. Se conserva tal como se publicó; sus arreglos propuestos ya están aplicados en `e27f50b5b` y medidos en la corrida 2.

| | |
| --- | --- |
| **Resultado** | **NO CERTIFICADA.** Fallan los puntos 2, 3, 4 y, por tanto, el 6. `AI_ANALYSIS_CERTIFIED_DIGEST` **no se fija**. |
| Fecha | 2026-11-22 |
| Cuenta / región | `637423209959` / `us-east-1` (perfil `default`), corrida autorizada por el dueño |
| Función | `arn:aws:lambda:us-east-1:637423209959:function:vendix-vex-analysis-sandbox` |
| Imagen desplegada | `637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-vex-analysis-runtime@sha256:c5aca9a06436e81e8ad5d10a7a5244504a5e2699b14565c275ef93cea105d6f5` (tag inmutable `rt-0a0ed8a9655b`, `linux/arm64`) |
| Runtime digest | `sha256:0a0ed8a9655bf63a59c6238766db07106e7a093dd4e93e90a2fa408a89e56f6b` (`./runtime-digest.sh`) |
| Base | `public.ecr.aws/lambda/python:3.12@sha256:ed196260cbf6f74e3f64dd141ebe2401d78a15e6355925da98a3d3c3b4d35c6a` (manifiesto arm64) |

### Historia de usuario

**Como** dueño de Vendix en producción, **quiero** que el análisis en Python de Vex corra en una Lambda aislada y certificada **para** encender `AI_ANALYSIS_SANDBOX_ENABLED` sin que el código generado pueda salir a internet, leer credenciales de AWS ni ver datos de otra tienda.

**Pasos para probarlo** (consola del operador, nunca con código del invitado en la Mac):

1. Invocar la función con un análisis trivial (sumar tres números) y ver la respuesta.
2. Invocar programas hostiles: salir a internet/DNS/IMDS/VPC de producción, escribir fuera de `/tmp`, leer `/proc` del padre, agotar memoria/CPU/procesos/disco, dejar un daemon vivo.
3. Invocar 100 veces alternando datos marcados de 3 tiendas sobre el mismo entorno caliente y buscar marcadores ajenos.
4. Revisar en IAM los permisos del rol de la función y de la política del backend.
5. Comparar el digest de la imagen desplegada con el que reporta la función y el que calcula el repo.

**Criterios de aceptación observables:**

- El análisis trivial responde `status: ok` con su tabla.
- Cada programa hostil termina en un código de error acotado (`ANALYSIS_MEMORY`, `ANALYSIS_TIMEOUT`, `ANALYSIS_RUNTIME`, `ANALYSIS_OUTPUT`) o con la conexión bloqueada, sin procesos ni archivos residuales.
- En las 100 ejecuciones, cada tienda solo ve su propio marcador.
- Los 6 puntos pasan sobre **el mismo digest desplegado**.

**Lo que se observó:** el análisis trivial responde `ANALYSIS_RUNTIME "sandbox error: PermissionError"` en 1-4 ms (4 de 4 invocaciones). El digest desplegado no puede ejecutar ningún análisis; y las correcciones evidentes abren fugas entre tiendas si se aplican a medias (ver hallazgos).

### Resultado por punto

| # | Punto | Digest desplegado `0a0ed8a9…` | Variante 3 de diagnóstico (arreglo propuesto, NO candidata) |
| --- | --- | --- | --- |
| 1 | Egreso cero | **PASA** a nivel de red (tras deshabilitar el DNS de la VPC). Medido desde la misma VPC, subredes y SG con la imagen de diagnóstico, porque el digest desplegado no llega a ejecutar código | PASA |
| 2 | FS, `/proc` y secretos | **FALLA**: el control `prctl(PR_SET_DUMPABLE, 0)` no existe en Lambda (seccomp lo deniega); el handler falla cerrado en el 100 % de las ejecuciones. Tolerar el error expone `/proc/<ppid>/environ` (nombres `AWS_*`) y la memoria del padre | PASA |
| 3 | Límites de recursos | **FALLA**: un daemon con doble `fork` + `setsid` sobrevive al `killpg` del handler (comprobado con la variante 2, que conserva esa lógica) | PASA |
| 4 | Multi-tenant (100 × 3 tiendas) | **FALLA**: sin ejecuciones posibles en el digest desplegado; con prctl tolerado, 8/9 respuestas traen marcadores de otra tienda; con el daemon vivo, la tienda siguiente es leída desde `/tmp` | PASA (100/100) |
| 5 | Política IAM | **PASA**: rol de ejecución solo ENI; sin política de recurso, sin URL, sin logs; la política del backend solo permite `InvokeFunction` sobre este ARN | n/a |
| 6 | Firma y digest | **FALLA (no se fija)**: la identidad sí es trazable (CodeSha256 = digest ECR = `ImageUri` fijado; `runtime_digest` de la respuesta = `runtime-digest.sh`), pero no hay certificación que fijar | n/a |

La variante 3 demuestra que el arreglo propuesto cierra los puntos 2-4, pero **no certifica nada**: su `runtime_digest` es una etiqueta sintética y su imagen nunca fue la desplegada. Certificar exige aplicar el arreglo en el repo, construir, desplegar y repetir T53 sobre ese digest.

### Recursos creados en esta corrida

Todos con prefijo `vendix-vex-analysis-*`, tags `project=vendix-vex-analysis` y `component=vex-f9-analysis-sandbox`. No se modificó ni borró ningún recurso preexistente.

| Recurso | Identificador |
| --- | --- |
| Repositorio ECR (IMMUTABLE, scan on push, AES256) | `arn:aws:ecr:us-east-1:637423209959:repository/vendix-vex-analysis-runtime` |
| Stack CloudFormation (desde `template.json`) | `vendix-vex-analysis-stack` |
| VPC `10.77.0.0/24`, DNS support/hostnames **false** | `vpc-033d4159415935325` |
| Subredes privadas (`MapPublicIpOnLaunch=false`) | `subnet-0ea4879910308ee13` (1a), `subnet-0e91710d8f4162007` (1b) |
| Tabla de rutas (solo `local`) | `rtb-0b86b1aebcb136966` |
| Security group (sin ingress; egress solo `127.0.0.1/32` tcp/1) | `sg-0e29560d2637f407e` |
| Rol de ejecución (solo ENI) | `arn:aws:iam::637423209959:role/vendix-vex-analysis-stack-ExecutionRole-0IwvkeIA9hkU` |
| Función (arm64, 1024 MB, 30 s, `/tmp` 512 MB, concurrencia reservada 3, sin variables de entorno) | `arn:aws:lambda:us-east-1:637423209959:function:vendix-vex-analysis-sandbox` |

Temporales de diagnóstico, **ya eliminados** al cerrar la corrida: función `vendix-vex-analysis-diag` (misma VPC, SG y rol) e imágenes ECR `diag-1`, `diag-2`, `variant-1`, `variant-2`, `variant-3`.

Efecto lateral automático de AWS: al crear la función, Lambda añadió al repositorio ECR la política `LambdaECRImageRetrievalPolicy` (`lambda.amazonaws.com` puede leer imágenes si `aws:sourceArn` es una función de esta cuenta). Es el comportamiento estándar; la imagen no contiene secretos.

### Hallazgo bloqueante 1 · `prctl` está prohibido en Lambda

`handler.py` llama `prctl(PR_SET_DUMPABLE, 0)` antes de lanzar al hijo y lanza `OSError` si falla. En Lambda, el perfil seccomp devuelve `EPERM` para **todo** `prctl` (incluso `PR_GET_DUMPABLE`). Entorno medido con una imagen de diagnóstico: `Seccomp: 2` con 6 filtros, `NoNewPrivs: 1`, `CapEff: 0`, uid 993 / gid 990, runtime = pid 2 (ppid 0), init = pid 1 (uid 0), `ptrace` denegado.

```text
$ aws lambda invoke --function-name vendix-vex-analysis-sandbox --payload <análisis trivial> ...
{"status": "error", "error_code": "ANALYSIS_RUNTIME", "error_message": "sandbox error: PermissionError",
 "runtime_digest": "sha256:0a0ed8a9…56f6b", "usage": {"duration_ms": 4}}      # 4/4 invocaciones
```

**Por qué no basta con ignorar el `EPERM`** (variante 1: mismo handler, `prctl` tolerado):

| Sonda desde el hijo | Resultado |
| --- | --- |
| `read /proc/<ppid>/environ` | LEGIBLE: contiene los **nombres** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (los valores nunca se imprimieron) |
| `open /proc/<ppid>/mem`, `/proc/<ppid>/maps`, `/proc/<ppid>/fd` | LEGIBLES |
| `process_vm_readv(ppid)` | PERMITIDO (64 bytes leídos) |
| `ptrace(PTRACE_ATTACH, ppid)` | denegado |
| 9 ejecuciones alternando 3 tiendas | **8/9 fallan**: desde la 2.ª, el heap del padre contiene el marcador de otra tienda y aparece en la respuesta |

**Arreglo validado (variante 2):** ejecutar el intérprete desde un archivo solo-ejecución (`chmod 0711 /var/lang/bin/python3.12`) hace que el kernel marque al proceso como no-dumpable sin `prctl`; los inodos de `/proc/<pid>` pasan a ser de root. El handler acepta el `EPERM` **solo** si lo comprueba:

| Sonda desde el hijo | Variante 1 | Variante 2/3 |
| --- | --- | --- |
| `/proc/<ppid>/environ`, `mem`, `maps`, `fd` | LEGIBLES | `PermissionError` |
| `process_vm_readv(ppid)` | PERMITIDO | `EPERM` |
| Entorno del padre (pid 2) desde el hijo | nombres `AWS_*` | `ENV_DENIED` |

### Hallazgo bloqueante 2 · un daemon sobrevive al `killpg`

El handler mata el grupo de procesos del hijo (`killpg`). Un invitado que hace doble `fork` + `setsid` queda en otra sesión y sobrevive. Prueba sobre la variante 2 (misma lógica de limpieza que el digest desplegado), siempre en el mismo entorno caliente `098e13d5`:

```text
spawn_daemon            ok   # el invitado deja un daemon escuchando en un socket abstracto
victim_tenant_A         ok   other_procs = 1:init;310:python3.12        <- el daemon sigue vivo
attacker_reads_daemon   ok   daemon_reply = {"pid": 310, "sid": 309, "stolen": ["TENANT-A-41e3746fe365b100"]}
```

La tienda A ejecutó su análisis y la ejecución siguiente (otra tienda) recibió el marcador de A leído desde `/tmp`. Rompe los puntos 3 y 4.

**Arreglo validado (variante 3):** tras matar el grupo, y antes de escribir los datos de cada tienda, el handler ejecuta `kill(-1, SIGKILL)`. En Lambda el handler es la tarea superior de su espacio de PIDs (ppid 0) y solo comparte uid con procesos del invitado, así que esa llamada mata a todo superviviente excepto a sí mismo y a init; el kernel la aplica bajo el lock de la lista de tareas (sin carrera con `fork`) y `SIGKILL` no se puede capturar. Fuera de ese espacio de PIDs (una Mac de desarrollo) se niega y falla cerrado.

```text
spawn_daemon            ok
victim_tenant_A         ok   other_procs = 1:init                       <- daemon eliminado
attacker_reads_daemon   ok   daemon_reply = NO_DAEMON ConnectionRefusedError
after_quit_probe        ok   other_procs = 1:init:uid=0:ppid=0; /tmp solo con el directorio propio
```

### Arreglo propuesto (requiere decisión y re-certificación)

No se aplicó al código del repo: cambiar `handler.py` o el `Dockerfile` cambia el runtime digest y reabre T53. Es la misma lógica que corrió en la variante 3 (allí, como una capa encima de la imagen desplegada con el handler parcheado y `chmod 0711` del intérprete):

```diff
--- Dockerfile
-RUN chmod -R a-w ${LAMBDA_TASK_ROOT} && chmod 0444 ${LAMBDA_TASK_ROOT}/handler.py ${LAMBDA_TASK_ROOT}/runner.py
+# Execute-only interpreter: Lambda's seccomp denies prctl, so the kernel marks
+# every process exec'd from it non-dumpable instead (/proc/<pid> owned by root).
+RUN chmod -R a-w ${LAMBDA_TASK_ROOT} && chmod 0444 ${LAMBDA_TASK_ROOT}/handler.py ${LAMBDA_TASK_ROOT}/runner.py \
+    && chmod 0711 /var/lang/bin/python3.12

--- handler.py
+import errno
 ...
     if libc.prctl(_PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
-        raise OSError(ctypes.get_errno(), "prctl(PR_SET_DUMPABLE, 0) failed")
+        err = ctypes.get_errno()
+        # AWS Lambda's seccomp profile denies prctl (EPERM). Accept ONLY if the
+        # kernel already made this process non-dumpable because the interpreter
+        # was exec'd from an execute-only file (Dockerfile: chmod 0711): the
+        # /proc/<pid> inodes of a non-dumpable task are owned by root.
+        if err == errno.EPERM and os.getuid() != 0 and os.stat("/proc/self/environ").st_uid == 0:
+            return
+        raise OSError(err, "prctl(PR_SET_DUMPABLE, 0) failed")
 ...
+def _reap_strays():
+    # killpg cannot reach a guest that double-forked and called setsid (T53).
+    # Inside Lambda the handler is the top task of its PID namespace (ppid 0)
+    # and shares its uid only with guest processes, so kill(-1) -- every task we
+    # may signal except ourselves and init -- removes every guest survivor. It
+    # is atomic against fork (tasklist lock) and SIGKILL cannot be caught.
+    # Outside that namespace (a developer machine) it refuses and fails closed.
+    if os.getppid() != 0:
+        raise OSError(errno.EPERM, "refusing kill(-1) outside the Lambda PID namespace")
+    try:
+        os.kill(-1, signal.SIGKILL)
+    except ProcessLookupError:
+        pass
 ...
     _harden_parent_dumpable()
+    _reap_strays()  # no survivor of a previous run may see this tenant's data
     os.mkdir(os.path.join(tmpdir, "in"), 0o700)
 ...
         finally:
             _kill_group(proc.pid)
+            _reap_strays()
```

Al aplicarlo hacen falta pruebas en `test_handler.py` que parcheen `os.kill`/`os.getppid` (nunca deben llamar a `kill(-1)` real en la Mac) y cubran: `EPERM` aceptado solo con `/proc/self/environ` de root, rechazo con cualquier otro errno, y `_reap_strays` negándose fuera del espacio de PIDs de Lambda.

### Ajuste de IaC incluido en este cambio · canal DNS cerrado

Los security groups no filtran el resolvedor de Amazon. Con `EnableDnsSupport: true`, el invitado resolvía nombres públicos y privados, lo que basta para exfiltrar datos codificados en subdominios aunque no haya ruta a internet:

| Sonda (DNS) | Antes (`EnableDnsSupport: true`) | Después (`false`) |
| --- | --- | --- |
| `getaddrinfo example.com` | OPEN `172.66.147.243` | BLOCKED (sin respuesta) |
| `getaddrinfo sts.amazonaws.com` / `lambda.us-east-1…` | OPEN | BLOCKED |
| `getaddrinfo` endpoint RDS de producción | OPEN (IP privada del RDS) | BLOCKED |
| `getaddrinfo` subdominio aleatorio (sin caché) | — | BLOCKED |
| UDP/53 a `10.77.0.2` (VPC) y `169.254.169.253` (Amazon DNS) | OPEN (respuesta de 72 bytes) | BLOCKED (timeout) |
| UDP/53 a `169.254.100.5` (proxy local de Lambda) | OPEN (respuesta) | BLOCKED (timeout) |

`template.json` queda con `EnableDnsSupport: false` y `EnableDnsHostnames: false`, y `template.test.cjs` lo fija (`no DNS channel`, RED observado antes del cambio y GREEN después). La asociación `rslvr-autodefined-rr-internet-resolver` que AWS crea en toda VPC queda inerte con el resolvedor deshabilitado (las sondas lo confirman).

### Evidencia por punto

Arnés: `aws lambda invoke` (un intento, sin reintentos) desde la Mac del operador; el código hostil solo se ejecutó dentro de Lambda. Cada respuesta se validó contra el sobre del protocolo (`vendix.analysis/v1`, `execution_id`, `nonce` y `runtime_digest` esperados). Los puntos 1-4 se midieron con la función temporal `vendix-vex-analysis-diag` (misma VPC, subredes, SG y rol que la oficial) porque el digest desplegado no ejecuta ningún análisis.

#### 1 · Egreso cero (variantes 2 y 3, idénticos)

| Destino | Resultado |
| --- | --- |
| DNS: `example.com`, subdominio aleatorio, STS, Lambda, endpoint RDS de producción | BLOCKED (sin respuesta) |
| UDP/53 a `10.77.0.2`, `169.254.169.253`, `169.254.100.5`, `8.8.8.8`, `1.1.1.1` | BLOCKED (timeout) |
| TCP/UDP a `1.1.1.1` y `8.8.8.8` (53/80/443), `https://example.com/`, IPv6 `2606:4700:4700::1111` | BLOCKED |
| IMDS `169.254.169.254` (TCP y HTTP), credenciales ECS `169.254.170.2`, Time Sync `169.254.169.123` | BLOCKED |
| IP privada de la EC2 de producción (22/80/443/3000), IP privada del RDS de producción (5432), VPC por defecto `172.31.0.2:53` | BLOCKED (timeout) |
| Sockets `SOCK_RAW` ICMP y `AF_PACKET` | BLOCKED (`EPERM`) |
| TCP connect a `169.254.100.5:53` (proxy DNS local de Lambda) | conecta, pero no responde a nada |
| TCP a `169.254.100.1:9001` (Runtime API de Lambda) | abierto: inherente a Lambda, solo sirve al propio entorno |

#### 2 · Sistema de archivos, `/proc` y secretos (variantes 2 y 3, idénticos)

| Sonda | Resultado |
| --- | --- |
| Escribir en `/var/task`, `handler.py`, `/var/runtime`, `/opt`, `/etc`, `site-packages`, `/usr/lib`, `/`; `chmod` del handler | `EROFS` |
| Escribir `/proc/sys/kernel/core_pattern` | `EACCES` |
| Escribir en el directorio propio de `/tmp` (control) | permitido |
| Entorno del hijo | sin claves `AWS_*` ni `LAMBDA_*` |
| Identidad del hijo | uid 993, `CapEff=0`, `NoNewPrivs=1`, seccomp activo |
| `/proc/<ppid>/environ`, `mem`, `maps`, `fd`; `process_vm_readv`; `ptrace` | denegados |
| `result.json` como symlink | `ANALYSIS_OUTPUT "result file cannot be opened safely"` |
| `result.json` como FIFO | `ANALYSIS_OUTPUT "result file is not a regular file"` |
| Logs de CloudWatch | no existen: el rol no tiene permisos de logs y no hay grupo `/aws/lambda/vendix-vex-analysis*` |

#### 3 · Límites de recursos (variante 3)

Tras cada caso, una sonda en el mismo entorno caliente lista procesos y `/tmp`.

| Caso hostil | Respuesta | Tiempo (s) | Después: procesos / `/tmp` libre |
| --- | --- | --- | --- |
| `bytearray` de 2 GiB | `ANALYSIS_MEMORY` | 2,8 | solo `init` / 513 MB |
| Lista que crece sin fin | `ANALYSIS_MEMORY` | 3,2 | solo `init` / 513 MB |
| numpy 30 000 × 30 000 | `ANALYSIS_MEMORY` | 2,7 | solo `init` / 513 MB |
| Bucle infinito de CPU | `ANALYSIS_TIMEOUT` (pared) | 25,7 | solo `init` / 513 MB |
| `sleep(120)` | `ANALYSIS_TIMEOUT` (pared) | 25,8 | solo `init` / 513 MB |
| Fork bomb | `ok`: 62 procesos antes de `RLIMIT_NPROC`, todos eliminados | 3,8 | solo `init` / 513 MB |
| Thread bomb | `ok`: 20 hilos antes del límite | 2,8 | solo `init` / 513 MB |
| Inundación de stdout | `ANALYSIS_RUNTIME "OSError: [Errno 27] File too large"` | 2,9 | solo `init` / 513 MB |
| Inundación de stderr con rutas | `ANALYSIS_RUNTIME` (mismo mensaje, rutas saneadas) | 2,9 | solo `init` / 513 MB |
| Archivo grande en `/tmp` | `ANALYSIS_RUNTIME "File too large"` | 2,8 | solo `init` / 513 MB |
| Llenar `/tmp` con muchos archivos | `ANALYSIS_RUNTIME "child exited without a result"` | 3,7 | solo `init` / 513 MB (limpio) |
| Salida de más de 256 KB | `ANALYSIS_OUTPUT "output exceeds 262144 bytes"` | 3,0 | solo `init` / 513 MB |
| `setsid()` en el hijo | `ANALYSIS_RUNTIME "PermissionError"` (ya es líder de sesión) | 2,9 | solo `init` / 513 MB |
| Matar al padre | `FunctionError: Runtime.ExitError` (falla cerrado) | 2,5 | solo `init` / 513 MB (entorno reciclado) |
| Daemon con doble `fork` + `setsid` | eliminado por `kill(-1)` (ver hallazgo 2) | 3,5 | solo `init` |

Los resultados de la variante 2 son los mismos caso por caso, salvo el daemon, que en ella sobrevive.

`RLIMIT_CPU` (15 s) nunca dispara antes de la pared de 25 s: con 1024 MB la función recibe ~0,58 vCPU. El límite de hilos real es de 12 a 20 porque `RLIMIT_AS` (768 MB) se agota con las pilas. CPython ignora `SIGXFSZ`, así que el invitado recibe `EFBIG` y el handler lo reporta como `ANALYSIS_RUNTIME` con la ruta saneada.

#### 4 · Aislamiento multi-tenant (variante 3)

100 invocaciones consecutivas, alternando A → B → C (34/33/33) con datos marcados distintos (40, 55 y 70 filas). Las 100 cayeron en el **mismo entorno caliente** (`546e6bb4/ppid=2`), el peor caso para residuos. Duración por análisis: 2138-2416 ms (mediana 2243 ms). Fallos: **0**.

| Comprobación por ejecución | Pasan |
| --- | --- |
| Sobre del protocolo válido (`execution_id`, `nonce`, `runtime_digest`) | 100/100 |
| `status: ok` | 100/100 |
| La tienda ve su propio marcador | 100/100 |
| La respuesta solo contiene el marcador propio | 100/100 |
| Ningún marcador ajeno en `/tmp` | 100/100 |
| Ninguna variable global de una ejecución anterior | 100/100 |
| `/tmp` solo con `in/sales.json`, `limits.json`, `source.py` propios | 100/100 |
| Total calculado correcto para los datos de la tienda | 100/100 |
| Ningún marcador en el log de la invocación | 100/100 |
| Memoria del padre ilegible (`/proc/<ppid>/mem` denegado) | 100/100 |

La variante 2 dio el mismo 100/100, pero la prueba del daemon demostró que ese verde no bastaba: el daemon esperaba quieto y leyó a la tienda siguiente. Por eso la variante 3 suma esa prueba (sección del hallazgo 2).

#### 5 · Política IAM (digest desplegado)

```text
rol de ejecución   trust: lambda.amazonaws.com · sts:AssumeRole
                   inline VpcEniOnly: ec2:CreateNetworkInterface, DescribeNetworkInterfaces,
                   DeleteNetworkInterface, AssignPrivateIpAddresses, UnassignPrivateIpAddresses
                   administradas: ninguna · permissions boundary: ninguno
lambda get-policy  ResourceNotFoundException (nadie más puede invocarla)
function URLs      ninguna
log groups         ninguno
red                rutas solo local · IGW 0 · NAT 0 · endpoints 0 · peering 0 · TGW 0
```

`aws iam simulate-custom-policy` con `backend-invoke-policy.json` (ARN real):

| Acción | `vendix-vex-analysis-sandbox` | `vendix-production-alerts-telegram` | otra función del prefijo |
| --- | --- | --- | --- |
| `lambda:InvokeFunction` | **allowed** | implicitDeny | implicitDeny |
| `lambda:UpdateFunctionCode` | implicitDeny | implicitDeny | implicitDeny |
| `lambda:InvokeFunctionUrl` | implicitDeny | implicitDeny | implicitDeny |

#### 6 · Identidad del digest (digest desplegado)

| Fuente | Valor |
| --- | --- |
| `Configuration.CodeSha256` | `c5aca9a06436e81e8ad5d10a7a5244504a5e2699b14565c275ef93cea105d6f5` |
| Digest en ECR del tag `rt-0a0ed8a9655b` | `sha256:c5aca9a0…d6f5` |
| `Code.ImageUri` / `ResolvedImageUri` | `…/vendix-vex-analysis-runtime@sha256:c5aca9a0…d6f5` (fijado por digest) |
| `runtime_digest` en la respuesta | `sha256:0a0ed8a9655bf63a59c6238766db07106e7a093dd4e93e90a2fa408a89e56f6b` |
| `./runtime-digest.sh` en el repo | `sha256:0a0ed8a9655bf63a59c6238766db07106e7a093dd4e93e90a2fa408a89e56f6b` |

La cadena es trazable, pero el digest no se certifica: fallan los puntos 2, 3 y 4.

### Hallazgos operativos (no bloquean por sí solos)

1. **Arranque en frío tras imagen nueva.** La primera invocación tras desplegar una imagen distinta superó los 25 s y respondió `ANALYSIS_TIMEOUT` (visto dos veces; la carga de la imagen es perezosa). En caliente, un análisis tarda ~2,1-2,4 s. Mitigación sugerida: invocar un análisis trivial justo después de cada despliegue, o importar numpy/pandas en el init del handler.
2. **Carrera del timer del host.** `SandboxLambdaClientService` aborta a `wall_ms` (25 s) exactos, y la Lambda responde su propio `ANALYSIS_TIMEOUT` a ~25,6 s (pared del hijo + limpieza). Un análisis que agota el tiempo llega al backend como `ANALYSIS_EXPIRED`, no como `ANALYSIS_TIMEOUT`, y la Lambda sigue ocupando concurrencia unos segundos. Conviene dar al hijo `wall_ms` menos un margen, o al host `wall_ms` más un margen.
3. **Matar al padre** (`os.kill(os.getppid(), SIGKILL)`) devuelve `FunctionError: Runtime.ExitError`: falla cerrado y Lambda recicla el entorno (la sonda siguiente solo ve `init`). El backend debe tratar un `FunctionError` como fallo sin resultado.
4. **Sin logs.** El rol no tiene permisos de CloudWatch Logs: no hay rastro de la fuente ni de las salidas fuera de la respuesta. La observabilidad queda en las métricas estándar de Lambda (invocaciones, errores, duración).

### Política del backend (NO aplicada)

No se modificó ningún rol ni política existente. JSON exacto (`backend-invoke-policy.json` con la región y la cuenta reales):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeAnalysisSandboxOnly",
      "Effect": "Allow",
      "Action": ["lambda:InvokeFunction"],
      "Resource": "arn:aws:lambda:us-east-1:637423209959:function:vendix-vex-analysis-sandbox"
    }
  ]
}
```

Comando para adjuntarla al rol de la instancia de producción, como política administrada nueva (el mismo patrón que las demás políticas de ese rol), **solo cuando el digest esté certificado**:

```bash
sed 's/<REGION>/us-east-1/; s/<ACCOUNT_ID>/637423209959/' \
  infra/agent-sandbox/python/backend-invoke-policy.json > /tmp/vendix-vex-analysis-invoke.json
aws iam create-policy --policy-name vendix-vex-analysis-invoke \
  --policy-document file:///tmp/vendix-vex-analysis-invoke.json
aws iam attach-role-policy --role-name vendix-ec2-production-role \
  --policy-arn arn:aws:iam::637423209959:policy/vendix-vex-analysis-invoke
rm /tmp/vendix-vex-analysis-invoke.json
```

Si el `.env` de producción define `AWS_ACCESS_KEY_ID`, el SDK usa ese usuario IAM antes que el rol de la instancia: en ese caso la política va en ese usuario, no en el rol.

### Valores para el release

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | `true` (solo cuando exista un digest certificado; hoy debe quedar sin definir o en `false`) |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | `arn:aws:lambda:us-east-1:637423209959:function:vendix-vex-analysis-sandbox` |
| `AI_ANALYSIS_LAMBDA_REGION` | `us-east-1` |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:0a0ed8a9655bf63a59c6238766db07106e7a093dd4e93e90a2fa408a89e56f6b` |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | **NO SE FIJA.** T53 falla. Sin este valor el backend mantiene la feature apagada |

### Costo mensual estimado

| Concepto | Estimación |
| --- | --- |
| ECR: una imagen de ~0,29 GB a USD 0,10/GB-mes | ~USD 0,03 |
| Lambda en reposo, VPC, subredes, SG, IAM, CloudFormation, ENI de Lambda | USD 0 |
| Lambda arm64 por análisis: ~2,3 s × 1 GB × USD 0,0000133334/GB-s + USD 0,0000002 por solicitud | ~USD 0,00003 |
| 10 000 análisis/mes | ~USD 0,31 |
| NAT, endpoints, CloudWatch Logs, transferencia | USD 0 (no existen) |

Total: ~USD 0,03/mes sin uso y menos de USD 1/mes hasta ~30 000 análisis.

### Para re-certificar

1. Aplicar el arreglo propuesto con sus pruebas offline (`node --test template.test.cjs`; `python3 -m unittest test_runner.py test_handler.py`).
2. `./runtime-digest.sh` → nuevo `AI_ANALYSIS_RUNTIME_DIGEST`; construir `linux/arm64` y subir con tag inmutable `rt-<12 hex>`.
3. Actualizar el stack con `ImageUri=…@sha256:<digest ECR>` e invocar un análisis trivial para calentar la imagen.
4. Repetir los 6 puntos sobre ese digest, incluida la prueba del daemon, y fijar `AI_ANALYSIS_CERTIFIED_DIGEST` solo si todo pasa.
