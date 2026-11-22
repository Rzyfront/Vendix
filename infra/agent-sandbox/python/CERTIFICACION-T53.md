# Certificación T53 · Lambda aislada de análisis de Vex (F9)

| | |
| --- | --- |
| **Resultado** | **NO CERTIFICADA.** Fallan los puntos 2, 3, 4 y, por tanto, el 6. `AI_ANALYSIS_CERTIFIED_DIGEST` **no se fija**. |
| Fecha | 2026-11-22 |
| Cuenta / región | `637423209959` / `us-east-1` (perfil `default`), corrida autorizada por el dueño |
| Función | `arn:aws:lambda:us-east-1:637423209959:function:vendix-vex-analysis-sandbox` |
| Imagen desplegada | `637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-vex-analysis-runtime@sha256:c5aca9a06436e81e8ad5d10a7a5244504a5e2699b14565c275ef93cea105d6f5` (tag inmutable `rt-0a0ed8a9655b`, `linux/arm64`) |
| Runtime digest | `sha256:0a0ed8a9655bf63a59c6238766db07106e7a093dd4e93e90a2fa408a89e56f6b` (`./runtime-digest.sh`) |
| Base | `public.ecr.aws/lambda/python:3.12@sha256:ed196260cbf6f74e3f64dd141ebe2401d78a15e6355925da98a3d3c3b4d35c6a` (manifiesto arm64) |

## Historia de usuario

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

## Resultado por punto

| # | Punto | Digest desplegado `0a0ed8a9…` | Variante 3 de diagnóstico (arreglo propuesto, NO candidata) |
| --- | --- | --- | --- |
| 1 | Egreso cero | **PASA** a nivel de red (tras deshabilitar el DNS de la VPC). Medido desde la misma VPC, subredes y SG con la imagen de diagnóstico, porque el digest desplegado no llega a ejecutar código | PASA |
| 2 | FS, `/proc` y secretos | **FALLA**: el control `prctl(PR_SET_DUMPABLE, 0)` no existe en Lambda (seccomp lo deniega); el handler falla cerrado en el 100 % de las ejecuciones. Tolerar el error expone `/proc/<ppid>/environ` (nombres `AWS_*`) y la memoria del padre | PASA |
| 3 | Límites de recursos | **FALLA**: un daemon con doble `fork` + `setsid` sobrevive al `killpg` del handler (comprobado con la variante 2, que conserva esa lógica) | PASA |
| 4 | Multi-tenant (100 × 3 tiendas) | **FALLA**: sin ejecuciones posibles en el digest desplegado; con prctl tolerado, 8/9 respuestas traen marcadores de otra tienda; con el daemon vivo, la tienda siguiente es leída desde `/tmp` | PASA (100/100) |
| 5 | Política IAM | **PASA**: rol de ejecución solo ENI; sin política de recurso, sin URL, sin logs; la política del backend solo permite `InvokeFunction` sobre este ARN | n/a |
| 6 | Firma y digest | **FALLA (no se fija)**: la identidad sí es trazable (CodeSha256 = digest ECR = `ImageUri` fijado; `runtime_digest` de la respuesta = `runtime-digest.sh`), pero no hay certificación que fijar | n/a |

La variante 3 demuestra que el arreglo propuesto cierra los puntos 2-4, pero **no certifica nada**: su `runtime_digest` es una etiqueta sintética y su imagen nunca fue la desplegada. Certificar exige aplicar el arreglo en el repo, construir, desplegar y repetir T53 sobre ese digest.

## Recursos creados en esta corrida

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

## Hallazgo bloqueante 1 · `prctl` está prohibido en Lambda

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

## Hallazgo bloqueante 2 · un daemon sobrevive al `killpg`

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

## Arreglo propuesto (requiere decisión y re-certificación)

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

## Ajuste de IaC incluido en este cambio · canal DNS cerrado

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

## Evidencia por punto

Arnés: `aws lambda invoke` (un intento, sin reintentos) desde la Mac del operador; el código hostil solo se ejecutó dentro de Lambda. Cada respuesta se validó contra el sobre del protocolo (`vendix.analysis/v1`, `execution_id`, `nonce` y `runtime_digest` esperados). Los puntos 1-4 se midieron con la función temporal `vendix-vex-analysis-diag` (misma VPC, subredes, SG y rol que la oficial) porque el digest desplegado no ejecuta ningún análisis.

### 1 · Egreso cero (variantes 2 y 3, idénticos)

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

### 2 · Sistema de archivos, `/proc` y secretos (variantes 2 y 3, idénticos)

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

### 3 · Límites de recursos (variante 3)

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

### 4 · Aislamiento multi-tenant (variante 3)

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

### 5 · Política IAM (digest desplegado)

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

### 6 · Identidad del digest (digest desplegado)

| Fuente | Valor |
| --- | --- |
| `Configuration.CodeSha256` | `c5aca9a06436e81e8ad5d10a7a5244504a5e2699b14565c275ef93cea105d6f5` |
| Digest en ECR del tag `rt-0a0ed8a9655b` | `sha256:c5aca9a0…d6f5` |
| `Code.ImageUri` / `ResolvedImageUri` | `…/vendix-vex-analysis-runtime@sha256:c5aca9a0…d6f5` (fijado por digest) |
| `runtime_digest` en la respuesta | `sha256:0a0ed8a9655bf63a59c6238766db07106e7a093dd4e93e90a2fa408a89e56f6b` |
| `./runtime-digest.sh` en el repo | `sha256:0a0ed8a9655bf63a59c6238766db07106e7a093dd4e93e90a2fa408a89e56f6b` |

La cadena es trazable, pero el digest no se certifica: fallan los puntos 2, 3 y 4.

## Hallazgos operativos (no bloquean por sí solos)

1. **Arranque en frío tras imagen nueva.** La primera invocación tras desplegar una imagen distinta superó los 25 s y respondió `ANALYSIS_TIMEOUT` (visto dos veces; la carga de la imagen es perezosa). En caliente, un análisis tarda ~2,1-2,4 s. Mitigación sugerida: invocar un análisis trivial justo después de cada despliegue, o importar numpy/pandas en el init del handler.
2. **Carrera del timer del host.** `SandboxLambdaClientService` aborta a `wall_ms` (25 s) exactos, y la Lambda responde su propio `ANALYSIS_TIMEOUT` a ~25,6 s (pared del hijo + limpieza). Un análisis que agota el tiempo llega al backend como `ANALYSIS_EXPIRED`, no como `ANALYSIS_TIMEOUT`, y la Lambda sigue ocupando concurrencia unos segundos. Conviene dar al hijo `wall_ms` menos un margen, o al host `wall_ms` más un margen.
3. **Matar al padre** (`os.kill(os.getppid(), SIGKILL)`) devuelve `FunctionError: Runtime.ExitError`: falla cerrado y Lambda recicla el entorno (la sonda siguiente solo ve `init`). El backend debe tratar un `FunctionError` como fallo sin resultado.
4. **Sin logs.** El rol no tiene permisos de CloudWatch Logs: no hay rastro de la fuente ni de las salidas fuera de la respuesta. La observabilidad queda en las métricas estándar de Lambda (invocaciones, errores, duración).

## Política del backend (NO aplicada)

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

## Valores para el release

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | `true` (solo cuando exista un digest certificado; hoy debe quedar sin definir o en `false`) |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | `arn:aws:lambda:us-east-1:637423209959:function:vendix-vex-analysis-sandbox` |
| `AI_ANALYSIS_LAMBDA_REGION` | `us-east-1` |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:0a0ed8a9655bf63a59c6238766db07106e7a093dd4e93e90a2fa408a89e56f6b` |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | **NO SE FIJA.** T53 falla. Sin este valor el backend mantiene la feature apagada |

## Costo mensual estimado

| Concepto | Estimación |
| --- | --- |
| ECR: una imagen de ~0,29 GB a USD 0,10/GB-mes | ~USD 0,03 |
| Lambda en reposo, VPC, subredes, SG, IAM, CloudFormation, ENI de Lambda | USD 0 |
| Lambda arm64 por análisis: ~2,3 s × 1 GB × USD 0,0000133334/GB-s + USD 0,0000002 por solicitud | ~USD 0,00003 |
| 10 000 análisis/mes | ~USD 0,31 |
| NAT, endpoints, CloudWatch Logs, transferencia | USD 0 (no existen) |

Total: ~USD 0,03/mes sin uso y menos de USD 1/mes hasta ~30 000 análisis.

## Para re-certificar

1. Aplicar el arreglo propuesto con sus pruebas offline (`node --test template.test.cjs`; `python3 -m unittest test_runner.py test_handler.py`).
2. `./runtime-digest.sh` → nuevo `AI_ANALYSIS_RUNTIME_DIGEST`; construir `linux/arm64` y subir con tag inmutable `rt-<12 hex>`.
3. Actualizar el stack con `ImageUri=…@sha256:<digest ECR>` e invocar un análisis trivial para calentar la imagen.
4. Repetir los 6 puntos sobre ese digest, incluida la prueba del daemon, y fijar `AI_ANALYSIS_CERTIFIED_DIGEST` solo si todo pasa.
