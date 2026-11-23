# Certificación T53 · Lambda aislada de análisis de Vex (F9)

| | |
| --- | --- |
| **Resultado vigente (corrida 6)** | **NO CERTIFICADA: pendiente de decisión de Rafael (B1).** Pasan 1, 2, 4, 5 y 6 sobre el mismo digest. Punto 3: todos los topes y los arreglos de B1 funcionan, pero el invitado **sigue pudiendo detener al vigilante** (`SIGSTOP`) hasta el tiempo máximo de la función. Es un riesgo de **disponibilidad, no de fuga**, medido y acotado abajo; por eso el punto 3 no se declara certificado. `AI_ANALYSIS_CERTIFIED_DIGEST` no se fija ni se toca; `AI_ANALYSIS_SANDBOX_ENABLED` sigue apagado. |
| Fecha | 2026-11-23 UTC (2026-11-22 Bogotá): B1 sobre la imagen anterior 00:50-01:02; despliegue 01:07-01:08; T53 completa sobre la imagen nueva 01:09-01:38 |
| Cuenta / región | `<account>` / `us-east-1`, corrida autorizada por el dueño |
| Función | `vendix-vex-analysis-sandbox` (stack `vendix-vex-analysis-stack`) |
| Imagen medida | `vendix-vex-analysis-runtime@sha256:b62b6f9f8964304299f807a1a9845c22ecccf1863fefa6e7b668bacf6cd6015b` (tag inmutable `rt-ada2b02f1d00`, `linux/arm64`, manifiesto OCI único) |
| Runtime digest | `sha256:ada2b02f1d0001dbb588377aea6abed9e35417f8e89c33b85c1c51d35751fd25` (`./runtime-digest.sh` sobre `26dd8aa11`; desde esta corrida cubre también `template.json`, `sha256 41ec84b7…8ab8`) |
| Código medido | `ab9e17822` (observaciones 1, 5 y 6 de la auditoría) + `26dd8aa11` (B1) |
| Despliegue | `update-stack --use-previous-template`, solo `ImageUri`; actualizó únicamente `AnalysisFunction` (01:07:43-01:08:00Z). `CodeSha256 = b62b6f9f…015b`, `Active`/`Successful`. Plantilla desplegada = `template.json` del repo (comparación JSON), drift `IN_SYNC` |
| Base | `public.ecr.aws/lambda/python:3.12@sha256:ed196260cbf6f74e3f64dd141ebe2401d78a15e6355925da98a3d3c3b4d35c6a` (sin cambios) |
| Evidencia | Arnés, resultados crudos de las 388 invocaciones y salidas de AWS, **fuera del repo público**: `~/.openclaw/tmp/encargos/vex-plus-f10/evidencia-t53/evidencia-t53-r6.tar.gz`, SHA-256 `9a1bebe0186c37bc85450a911ae54adfd4efefd269252593587a6fe8677ab4ec`; dentro, `r6/SHA256SUMS` (95 archivos, SHA-256 `8b1044b63576f69e023d1ef5c0d5a27c51cad99ce5b2acf53afa474d887926c4`) y `r6/MANIFIESTO.md` (`f2e7cbeb45f2bae1938a5dd2b1a3ca5df2da78541d74a6c28f0b95f7455fcbdb`). Ver «Evidencia auditable y firma» |
| Firma | Commit de este documento y tag anotado `t53-r6-cert`, firmados con SSH (ed25519, huella `SHA256:adPIjYArS9wqXupW+g2x59pToW+/CxA2zEfQ1mWSrYQ`) |

Las corridas 5, 4, 3, 2 y 1 quedan abajo como historial. Higiene: en este documento la cuenta, el rol, la VPC, subredes, security group e IPs internas se sustituyeron por `<account>`, `<role>`, `<vpc-id>`, `<subnet-id>`, `<sg-id>`, `<internal-ip>`; los valores reales están solo en la evidencia privada (`valores-reales.txt`). **Commits anteriores de la rama todavía contienen el ID de cuenta y esos valores**; no se reescribió la historia (lo decide Rafael).

## Corrida 6 · historia de usuario

**Como** dueño de Vendix en producción, **quiero** saber, con evidencia que un tercero pueda repetir y verificar, si un análisis hostil puede detener o matar al vigilante de la Lambda y dejar inservibles los entornos reservados para las demás tiendas, **para** decidir si enciendo `AI_ANALYSIS_SANDBOX_ENABLED` o si hace falta otra arquitectura.

**Pasos para probarlo** (consola del operador; el código hostil solo corre dentro de Lambda):

1. Sobre la imagen certificada anterior, invocar un análisis que detiene a su padre (`SIGSTOP`) y luego: nada; crea enlaces duros en la raíz de `/tmp` durante 25 s (un inodo, y rotando inodos); o crea directorios durante 25 s. Tras cada uno, tres tiendas A, B y C.
2. Invocar un análisis que deja un daemon (doble `fork` + `setsid`) bajando límites y subiendo `nice` de todo proceso del uid mientras inunda `/tmp`, y mata a su padre; después A, B y C leen límites y `nice` del handler nuevo.
3. Desplegar la imagen con los arreglos, repetir 1 y 2 y la T53 completa (egreso, FS/`/proc`/secretos, límites, 100 × 3 tiendas, IAM/red, digests).
4. Comprobar el SHA-256 de la evidencia y la firma del tag (`git tag -v t53-r6-cert`).

**Criterios de aceptación observables:** ninguna tienda ve datos de otra; tras cada ataque el entorno vuelve a `ok` con `/tmp` estable y el handler con los valores de Lambda; el atacante no consume el presupuesto de la tienda siguiente (como mucho una respuesta rápida `sandbox busy`); la evidencia y la firma se verifican sin acceso a la cuenta.

**Lo que se observó:** ninguna fuga (100/100 en los 16 controles, 293/293 sobres con el digest esperado). Lambda **reinicia el entorno** tras `Sandbox.Timedout` o la muerte del runtime (proceso `init` nuevo; ningún proceso del invitado sobrevive en 36 de 36 casos, sumando ambas imágenes) y **conserva `/tmp`**. Con los arreglos, la limpieza sale del presupuesto de la tienda y pasa a INIT; pero un invitado que para al vigilante y crea directorios durante 25 s deja ~16 s de limpieza que, repartidos, producen 4 respuestas `sandbox busy` seguidas. El vigilante **no se puede proteger** de `SIGSTOP` en Lambda (mismo uid; `seccomp`, `prctl`, `unshare` y `ptrace` denegados).

## Corrida 6 · resultado por punto (digest `b62b6f9f…` / runtime `ada2b02f…`)

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Egreso cero | **PASA.** `RLIMIT_NOFILE=(0,0)`, descriptores `0-3`; TCP a Runtime API, IMDS, credenciales, proxy DNS, internet, EC2/RDS de producción (`<internal-ip>`), DNS de la VPC, NTP/UDP, TCP6, `AF_UNIX`, netlink, `getaddrinfo` → `EMFILE`; raw y `AF_PACKET` → `EPERM`. **R1** (`/runtime/invocation/next` con `urllib`) → falla sin abrir nada. **R2**: atacante C 19 s, 380/380 `EMFILE` → A `ok` con solo su marcador → C 2 s, 40/40 `EMFILE` |
| 2 | FS, `/proc` y secretos | **PASA.** Igual que la corrida 5 (detalle abajo) |
| 3 | Límites de recursos | **Topes: PASAN. B1: riesgo residual abierto → NO CERTIFICADO.** 25 casos clásicos, daemon, 9 ataques de enlaces duros (2,0-2,3 s), 8 ataques a los atributos del handler y la observación 1, cada uno seguido de tiendas: 79/79 `ok`, `/tmp` estable, solo `init`, handler con los valores de Lambda. B1: ver abajo |
| 4 | Multi-tenant (100 × 3) | **PASA.** 100/100 en los 16 controles |
| 5 | Política IAM y red | **PASA.** Sin cambios; drift `IN_SYNC` (0); `simulate-custom-policy`: `InvokeFunction` `allowed` solo sobre esta función |
| 6 | Firma y digest | **PASA.** Digest ECR del tag `rt-ada2b02f1d00` = `CodeSha256` = `ResolvedImageUri` = `Code.ImageUri` = parámetro `ImageUri` = `sha256:b62b6f9f…015b`; las 293 respuestas con sobre (de 313 invocaciones sobre la imagen; las 20 restantes son `Sandbox.Timedout`/`Runtime.ExitError` buscados) traen `runtime_digest = sha256:ada2b02f…fd25` = `./runtime-digest.sh` en `26dd8aa11`. Imagen local verificada antes del push (`ENV`, `handler.py`/`runner.py` byte a byte, intérprete `0711`). Commit y tag firmados (SSH) |

## B1 · el invitado detiene o mata al vigilante

Todos los topes de `/tmp` los aplica el proceso padre, y el invitado comparte su uid: puede enviarle `SIGSTOP` o `SIGKILL`. Se midió primero sobre la imagen anterior (`rt-1f10b7243591`, sin arreglos) y después sobre la nueva. Cada ataque, seguido de tres tiendas A, B y C con una sonda sin descriptores (`statvfs`/`stat` de `/tmp`, `prlimit64`/`getpriority`/`sched_*` del handler, PIDs vivos). «handler» es la duración que informa el handler; «cliente», la latencia total (incluye el INIT del runtime nuevo).

| Experimento | Imagen anterior `1f10…` | Imagen nueva `ada2…` |
| --- | --- | --- |
| **`SIGSTOP` al padre, sin inundar** (×2) | `Sandbox.Timedout` a 30,1 s; entorno reiniciado (`init` nuevo); A, B, C `ok` en 2,4-2,5 s; `/tmp` intacto | igual (30,1-30,3 s; A, B, C `ok` 2,4-2,5 s) |
| **`SIGSTOP` + enlaces duros en la raíz de `/tmp` 25 s, un inodo** (×5; ext4 corta en 65 000 enlaces por inodo, `EMLINK`) | la raíz pasa de 4 KiB a 1,5 MB (−370 bloques) la primera vez y no crece más; tienda siguiente `ok`, handler 3,1-3,2 s (+0,65 s de limpieza dentro de su presupuesto) | la raíz igual (1,5 MB, una vez); tienda siguiente `ok`, handler 2,4-2,5 s (la limpieza pasa a INIT), cliente 3,1-3,4 s |
| **`SIGSTOP` + enlaces duros rotando inodos (`mkfifo`) 25 s** (×5) | la raíz pasa a 10,0 MB (−2 078 bloques, 8,1 MB) la primera vez y no crece más; tienda siguiente `ok`, handler 7,2 s la primera vez y 4,6-4,8 s después | la raíz a 10,0 MB (−2 062 bloques), una vez; tienda siguiente `ok`, handler 2,5-2,6 s, cliente 5,4 s la primera vez y 4,0-4,2 s después |
| **`SIGSTOP` + `mkdir` 25 s** (×2) | tienda siguiente `ok` tras **19,2 / 19,9 s** de handler (la limpieza consume su presupuesto) | INIT limpia 7 s; tienda siguiente `sandbox busy` (cliente 9,4 s, handler 2,0 s); dos tiendas más y la repetición del atacante `sandbox busy` en 2,0-2,2 s; la quinta invocación `ok` (2,9 s). Recuperación ≈ 16 s de limpieza, **4 respuestas `sandbox busy`** |
| **Daemon** (doble `fork` + `setsid`) que baja `NOFILE` y sube `nice` (`PRIO_USER`) de todo el uid e inunda `/tmp`; el invitado mata al padre (×2) | `Runtime.ExitError` a 2,4 s; Lambda reinicia también `init`; A, B, C: `NOFILE (1024, 1024)`, `nice 0`, solo `init` | igual (2,2-2,3 s) |
| **Raíz de `/tmp` y E/S** (obs. 2 y 3): `chmod`, `chown`, `utime`, `setxattr` (`user.`/`trusted.`) sobre `/tmp`; `ioprio_set` y `uclamp` sobre el handler | todo `EPERM`; `uclamp` `ENOTSUP`; `/tmp` es `041777`, uid 0, sin xattrs; A, B, C sin cambios | igual |

**Qué se arregló** (`26dd8aa11`):

1. **Sin base capturada al importar.** La guarda compara con una tabla fija de los valores que Lambda da al runtime (los 16 `RLIMIT_*` medidos con `prlimit64` desde un invitado, `nice 0`, afinidad = CPUs en línea por `sysconf`, `SCHED_OTHER`), no con lo observado al importar. Restaura lo restaurable y, si no, reinicia el runtime en la invocación del atacante.
2. **Supervivientes muertos antes de fijar el estado.** `kill(-1, SIGKILL)` en INIT (al importar, antes de la primera invocación del runtime nuevo) y al principio de cada invocación, antes de la guarda y de validar la petición. Se mantiene `kill(-1)` y no un recorrido de `/proc` con `pidfd`/`starttime`: el kernel lo aplica bajo el lock de la lista de tareas, sin carrera con `fork`, y nunca alcanza al propio handler ni a `init` (el runtime nuevo **es** el handler); medido: ningún proceso del invitado sobrevive al reinicio de Lambda (36/36).
3. **Limpieza de arranque acotada.** INIT limpia `/tmp` hasta 7 s (fuera del presupuesto de la tienda); después, como mucho 2 s por invocación antes de responder `sandbox busy`, en lugar de hasta ~20 s.
4. **Guarda periódica.** La guarda corre en cada vigilancia de 50 ms mientras corre el invitado y tras la limpieza posterior: el ataque `prlimit NOFILE` blando → 4, que en la corrida 5 terminaba en un `ANALYSIS_RUNTIME` engañoso, ahora termina en `ok`. No es un hilo aparte: `SIGSTOP` detiene todos los hilos del proceso, así que un hilo no añade nada frente a B1 y el bucle de vigilancia ya existe.
5. **Raíz de `/tmp` vigilada.** Antes de cada invitado se comprueba `041777`, uid 0 y ausencia de xattrs; si cambia, falla cerrado (el handler no puede restaurarla: no es su dueño).

**Qué no se puede arreglar en Lambda: aislar al vigilante por uid o por seccomp.** El handler corre como uid 993 sin capacidades (`capget` 0/0), así que no puede lanzar al invitado con otro uid; `seccomp()` (`EPERM`) impide un filtro que bloquee `kill(getppid())`; `prctl` (`EPERM`) impide `PR_SET_NO_NEW_PRIVS`/`PDEATHSIG`; `unshare(CLONE_NEWPID)`/`CLONE_NEWNET` (`EPERM`) impide esconder el PID del padre en otro espacio; `ptrace` (`EPERM`) impide supervisar al invitado desde fuera. Evidencia: punto 2 de esta corrida.

### Riesgo residual (disponibilidad, no fuga)

Un invitado puede dejar ciego al vigilante. Lo que eso permite, medido:

- **Por invocación hostil:** ocupa uno de los 3 entornos reservados durante **≤ 30 s** (tiempo máximo de la función) y deja `/tmp` con restos. El entorno se reinicia sin ningún proceso del atacante, y la limpieza termina **antes** de que ninguna tienda escriba datos.
- **Recuperación medida:** enlaces duros (peor caso medido): +1-3 s de latencia de cliente para la primera tienda; `mkdir` 25 s: ~16 s de limpieza, 4 respuestas `sandbox busy` (cada una en ~2 s) antes de la primera `ok`.
- **Disco:** la raíz de `/tmp` crece una sola vez hasta ~10 MB por entorno (de 512 MB; ext4 no la encoge) y los ataques siguientes reutilizan sus huecos: 5 de 5 sin crecimiento.
- **Sostenido:** un atacante que repite el ataque con 3 invocaciones simultáneas puede ocupar los 3 entornos reservados y dejar el análisis **sin servicio para todas las tiendas** mientras siga. No se midió el límite de tasa del backend por tienda.
- **Fuga:** ninguna medida. Sigue en pie todo lo de los puntos 1, 2 y 4.

### Experimento obligatorio en cada corrida

`harness/b1.py` (evidencia privada) con `stop 2`, `flood 5`, `floodmany 5`, `mkdir 2`, `daemon 2`, `attrs 1`. Criterios: cero marcadores ajenos; tras cada ataque, entorno con solo `init`, handler con los valores de la tabla, `/tmp` sin crecer después de la primera vez; respuestas `sandbox busy` ≤ 4 por ataque y ninguna tienda con más de 3 s de handler.

## Decisión pendiente de Rafael

| Opción | Qué implica | Costo |
| --- | --- | --- |
| **(a) Aceptar el riesgo documentado y mantener el interruptor apagado hasta una nueva arquitectura** | El código y la imagen de la corrida 6 quedan desplegados y apagados. Si algún día se encendiera tal cual, un análisis hostil (una tienda maliciosa o una inyección en el prompt) puede degradar el análisis de **todas** las tiendas: ≤ 30 s por ataque más la recuperación medida, y sin servicio mientras repita el ataque en paralelo. Sin fuga de datos medida | USD 0 y ningún esfuerzo adicional |
| **(b) Aislamiento por inquilino** | Lambda ofrece `TenancyConfig.TenantIsolationMode = PER_TENANT` (verificado en el CLI 2.33 y en el esquema de CloudFormation de `AWS::Lambda::Function`; es de solo creación, así que **reemplaza la función**) y cada invocación lleva `TenantId`: los entornos de ejecución nunca se comparten entre inquilinos. Con `TenantId` = id de la tienda, un `SIGSTOP` o una inundación solo afectan a entornos de la propia tienda. Complemento necesario en ambos casos: limitar a 1 análisis simultáneo por tienda en el backend, para que una tienda no ocupe toda la concurrencia reservada. **No probado.** | Estimación: 2-3 días (plantilla y recreación de la función, `TenantId` en `sandbox-lambda-client.service.ts` con su spec, límite por tienda, T53 corrida 7 con B1 cruzado entre tiendas). Más arranques en frío (15-20 s medidos por entorno nuevo) y precio del modo por inquilino **no verificado**. Alternativa sin Lambda (contenedor por tienda en ECS/Fargate): 1-2 semanas |

## Observaciones de la auditoría independiente: estado

| # | Observación | Estado |
| --- | --- | --- |
| 1 | Tope de 256 KiB estirable 9× enlazando una entrada como `result.json` | **Cerrada** (`ab9e17822`): solo se acredita el inodo de resultado del runner (regular, un enlace, ni entrada ni flujo). Spec RED/GREEN; en Lambda, 2 de 2 ataques → `ANALYSIS_RUNTIME` en 2,25-2,26 s, tienda siguiente `ok` |
| 2 | Raíz de `/tmp` no vigilada | **Cerrada con evidencia** (`EPERM` en las 6 operaciones; `041777`, uid 0, sin xattrs) y comprobada antes de cada invitado |
| 3 | `ioprio`/`uclamp` fuera de la guarda | **Cerrada con evidencia**: `ioprio_set` sobre el handler `EPERM`, `uclamp` `ENOTSUP`; no se añaden a la guarda |
| 4 | Memoria fuera de `RLIMIT_AS` (`shm`/`msg`, 64 × 768 MB) | **No probada** en esta corrida |
| 5 | Specs de Python fuera de CI | **Cerrada**: `.github/workflows/agent-sandbox-python.yml`; el archivo entero ya no falla en Linux (libc por `dlopen(NULL)`; ganchos solo-Lambda neutralizados en el fixture). En la base de la imagen (Linux arm64, root) pasan 13/13 de `test_runner` y 65/65 de `test_handler`, clase por clase |
| 6 | El digest no cubre `template.json` | **Cerrada**: `runtime-digest.sh` lo incluye. Un cambio aplicado en AWS sin pasar por el repo lo detectan el drift de CloudFormation y el `sha256` de `template.json` de esta tabla. La comparación `certified !== digest` del backend no se tocó (fuera de alcance) |
| 7 | Cifras de costo | **Corregidas** (abajo) |
| 8 | Sin rollback | **Cerrada**: sección «Rollback» del README |
| 9 | Sin diagnóstico en producción | Sin cambios (sin logs por diseño). `numpy 30 000²` → `ANALYSIS_MEMORY` en 2,2 s, 1 de 1 |
| 10 | 4 HIGH en ECR | Mismos conteos en `rt-ada2b02f1d00` (4 HIGH, 6 MEDIUM, 1 LOW); **sin análisis de alcance** |

## Evidencia por punto (corrida 6)

Arnés: `boto3` desde la evidencia privada (ver «Evidencia auditable y firma»); ningún programa hostil se ejecutó en la Mac. Primer análisis tras el despliegue: **20,3 s de handler en frío**; después, 2,2-2,8 s.

### 1 · Egreso cero

Además de la tabla: `prlimit64(self, NOFILE, 64)` → `EPERM`; `setrlimit` (1,1)/(0,1)/(1024,1024) → `ValueError`; sigue `(0, 0)`; hijo con `fork` → `socket` `EMFILE`; `exec` de `python3` → exit 127.

### 2 · Sistema de archivos, `/proc` y secretos

`mkdir` en 9 rutas de sistema `EROFS` y en `/root` `EACCES`; `/dev/shm`, `/dev/mqueue` `ENOENT`; `truncate`/`chmod`/`rename` de `handler.py`, symlink en `/var/task`, `utime` del intérprete `EROFS`; `open` `EMFILE`; entorno `HOME, LANG, MKL/OMP/OPENBLAS_NUM_THREADS, PATH, PYTHONDONTWRITEBYTECODE, TMPDIR`; uid/euid 993, gid 990, sin grupos, `capget` 0/0; `/proc/<ppid>/{environ,mem}`, `/proc/self/environ`, `/proc/1/environ` de uid 0; `readlink` de `exe`, `cwd`, `root`, `fd/0`, `fd/3` `EACCES`; `process_vm_readv`, `ptrace`, `unshare`, `seccomp`, `prctl`, `add_key` `EPERM`; intérprete `0711`. `result.json` symlink, FIFO o directorio → `ANALYSIS_OUTPUT` (`cannot be opened safely` / `is not a regular file`); `.part` cambiado por symlink → `cannot be opened safely`; `result.json` symlink previo y fin normal → `ok` con el resultado propio. Sonda tras cada uno: limpia.

### 3 · Límites de recursos

Cada caso va seguido de una sonda (tres tras enlaces duros, atributos y obs. 1): 79/79 `ok` en 2,2-2,4 s, solo `init`, handler `NOFILE (1024, 1024)`, `CPU` ilimitado, `nice 0`, afinidad `[0, 1]`, `SCHED_OTHER`; `/tmp` en 147 982 inodos y la raíz crece de 4 KiB a 72 KiB con los ataques a la raíz (tope de 64 entradas) y luego se mantiene.

| Caso hostil | Respuesta | Handler (s) |
| --- | --- | --- |
| `bytearray` 2 GiB / lista sin fin / numpy 30 000² | `ANALYSIS_MEMORY` | 2,2 / 5,4 / 2,2 |
| CPU infinita / `sleep(120)` | `ANALYSIS_TIMEOUT` | 23,0 / 23,0 |
| Fork bomb (hijos dormidos) / exponencial + `setsid` | `ok` / `ANALYSIS_TIMEOUT` | 3,3 / 23,4 |
| Thread bomb | `ok` | 2,4 |
| Inundación de stdout / stderr con rutas / 600 MB por el descriptor de resultado | `ANALYSIS_RUNTIME "File too large"` (sin rutas) | 2,3 |
| Abrir un archivo nuevo en `/tmp` | `ANALYSIS_RUNTIME` con el mensaje del sello | 2,3 |
| Salida de más de 256 KB | `ANALYSIS_OUTPUT` | 2,3 |
| `setsid()` / cerrar el descriptor de resultado | `ANALYSIS_RUNTIME` (`EPERM` / `EBADF`) | 2,3 |
| Matar al padre | `Runtime.ExitError`; la sonda siguiente, limpia | 2,1 (cliente) |
| Daemon con doble `fork` + `setsid` | control: vivo en su ejecución; tienda siguiente: solo `init` | 2,9 |
| `mkdir` 20 000 / 60 000 / 200 000 / hasta `ENOSPC` / cadena `mkdir` + `chdir` / 8 procesos / symlinks largos | `ANALYSIS_RUNTIME "too many files or directories created in the sandbox"` | 1,96-2,09 |
| Enlaces duros a la entrada de la tienda / a un FIFO | el mismo `ANALYSIS_RUNTIME` | 2,2 |
| **Enlaces duros 15 s / 23 s en su directorio; en la raíz 15 s × 1 y 23 s × 6**, cada uno + A, B, C | el mismo `ANALYSIS_RUNTIME`; 27/27 tiendas `ok` | 1,94-2,30 |
| **Obs. 1:** `link(in/n.json, result.json)` + ~300 KiB de entradas (× 2) | el mismo `ANALYSIS_RUNTIME` | 2,25 / 2,26 |

**Atributos del handler** (cada uno + A, B, C; 24/24 `ok` con el handler en los valores de la tabla):

| Ataque | Atacante |
| --- | --- |
| `prlimit` `NOFILE` blando → 4 / varios blandos (`NOFILE`, `AS`, `NPROC`, `FSIZE`, `CPU`, `STACK`) | `ok` (la guarda de cada vigilancia lo restaura; en la corrida 5, `ANALYSIS_RUNTIME` engañoso) |
| `prlimit` `NOFILE` duro → 4 | `Runtime.ExitError` (reinicio en la invocación del atacante) |
| `prlimit` `CPU` blando → 1 s / `sched_setaffinity(ppid, {0})` | `ok` |
| `setpriority(ppid, 19)` / `setpriority(PRIO_USER, uid, 19)` / `sched_setscheduler(ppid, SCHED_IDLE)` | `Runtime.ExitError` |

B1: tabla de la sección B1.

### 4 · Aislamiento multi-tenant

100 invocaciones consecutivas A → B → C (34/33/33) con 40, 55 y 70 filas marcadas, 01:33:06-01:37:55Z, en el mismo entorno; 2 608-2 827 ms por análisis (mediana 2 726). Cada ejecución busca y luego deja un daemon con doble `fork` + `setsid` y el `shm` adjunto, un symlink `/tmp/vex-t53-plant`, `shm` + `msg` + `sem` con claves fijas y su marcador y una variable en `builtins`, e intenta `add_key`/`keyctl`.

| Comprobación por ejecución | Resultado |
| --- | --- |
| Sobre válido / `status: ok` / total correcto | 100/100 |
| Marcador propio / la respuesta solo trae el propio / log sin marcadores | 100/100 |
| Symlink, variable global, `shm`, `msg` y `sem` de la anterior ausentes (`ENOENT`) / solo `init` / `environ` del padre de root | 100/100 |
| Siembra confirmada (`msgsnd`, `semctl SETVAL` → 0) y control positivo (`shm`, `msg`, `sem` = 930, symlink) | 100/100 |
| `/tmp` estable (131 947 bloques, 147 982 inodos) | 100/100 |
| Keyring: `add_key` / `keyctl SEARCH` | `EPERM` / `EPERM` |

Nota del arnés: el control «solo `init`» se evaluó al principio contra un formato equivocado (`['1:u0']`, cuando el programa escribe `only init`); se reevaluaron los 16 controles desde los resultados crudos, sin invocar nada (`p4-recheck.log` en la evidencia).

### 5 · Política IAM y red

Solo lectura (más una detección de drift). Rol de ejecución `<role>`: confianza solo `lambda.amazonaws.com`, sin boundary, 0 políticas administradas, inline única `VpcEniOnly` (5 acciones ENI sobre `*`). Función sin política de recurso, URL, alias, mapeos, capas ni variables; concurrencia reservada 3; `MemorySize` 1024, `Timeout` 30, `arm64`; el log group `/aws/lambda/vendix-vex-analysis-sandbox` no existe. VPC `<vpc-id>` (`10.77.0.0/24`): DNS support/hostnames `false/false`, rutas solo `local`, IGW/NAT/endpoints/peering/TGW 0, subredes sin IP pública, SG sin ingress y egress solo `127.0.0.1/32` tcp/1. Drift `IN_SYNC` (0). `simulate-custom-policy` de `backend-invoke-policy.json` (con región y cuenta instanciadas): `InvokeFunction` `allowed` sobre esta función e `implicitDeny` sobre otra; `UpdateFunctionCode`, `UpdateFunctionConfiguration` e `InvokeFunctionUrl` `implicitDeny`. La política `vendix-vex-analysis-invoke` no existe (no aplicada).

### 6 · Digest

Ver la tabla de resultados. `./runtime-digest.sh` en `26dd8aa11` = `sha256:ada2b02f…fd25`; `ENV ANALYSIS_RUNTIME_DIGEST` de la imagen igual; `handler.py` `25bc77d3…13d1` y `runner.py` `8c8b4f0e…6cc8` idénticos en la imagen y en el repo.

## Evidencia auditable y firma (B2)

- **Dónde:** `~/.openclaw/tmp/encargos/vex-plus-f10/evidencia-t53/` en la máquina del operador, fuera del repo público (contiene la cuenta, IDs de red e IPs internas). Se entrega bajo pedido.
- **Qué:** `evidencia-t53-r6.tar.gz` (SHA-256 `9a1bebe0186c37bc85450a911ae54adfd4efefd269252593587a6fe8677ab4ec`) con `r6/`: el arnés (`harness/`), cada invocación completa en `<fase>/raw.jsonl` (B1 antes y después, puntos 1-4), las salidas de AWS de los puntos 5 y 6 (`p56/`), la plantilla desplegada, el log de construcción, `MANIFIESTO.md` (qué se ejecutó, cuándo y con qué resultado, por fase) y `SHA256SUMS` (95 archivos).
- **Cómo verificar:** `shasum -a 256 evidencia-t53-r6.tar.gz`; `tar xzf …` y `cd r6 && shasum -a 256 -c SHA256SUMS`; repetir un punto con `T53_DIGEST=<runtime digest> python -I harness/<fase>.py <dir>` (requiere `lambda:InvokeFunction` sobre la función).
- **Firma:** el commit que publica este documento y el tag anotado `t53-r6-cert` están firmados con una clave SSH dedicada (ed25519, comentario `vendix-t53-signing`, huella `SHA256:adPIjYArS9wqXupW+g2x59pToW+/CxA2zEfQ1mWSrYQ`). Clave pública: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC4JLezCK3YzQGbRTZvfjpmmuMD4SoRP9D26i+GQHWhz`. Verificación:

  ```sh
  echo 'aurora@abkbusiness.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC4JLezCK3YzQGbRTZvfjpmmuMD4SoRP9D26i+GQHWhz' > /tmp/allowed_signers
  git -c gpg.ssh.allowedSignersFile=/tmp/allowed_signers tag -v t53-r6-cert
  git -c gpg.ssh.allowedSignersFile=/tmp/allowed_signers log --show-signature -1 t53-r6-cert
  ```

  La firma ata el texto de este documento (y con él los SHA-256 de la evidencia y los digests) a esa clave; no hay firma de la imagen ni atestación de procedencia (el build usa `--provenance=false`).

## Hallazgos operativos (corrida 6)

1. **Lambda reinicia el entorno** tras `Sandbox.Timedout` o la muerte del runtime: `init` nuevo y ningún proceso del uid del invitado (36/36: 16 sobre la imagen anterior y 20 sobre la nueva, cada uno seguido de una sonda); `/tmp` se conserva.
2. **Recursos:** se subió a ECR `rt-ada2b02f1d00`; el stack se actualizó una vez, solo `ImageUri`. En ECR quedan 7 imágenes `rt-*` (suma de tamaños 2,04 GB). Colima se apagó tras el push.
3. **Arranque en frío:** 20,3 s de handler en el primer análisis tras el despliegue (15,2 s en la corrida 5).
4. **Arnés:** el control «solo `init`» del punto 4 se corrigió y reevaluó desde los crudos (ver punto 4).

## Costo mensual estimado (corregido, obs. 7)

| Concepto | Estimación |
| --- | --- |
| ECR: 7 imágenes `rt-*`, 2,04 GB sumando tamaños, a USD 0,10/GB-mes | ≤ USD 0,20 (ECR cobra capas únicas: el real es menor, no verificado) |
| Lambda en reposo, VPC, subredes, SG, IAM, CloudFormation, ENI | USD 0 |
| Lambda arm64 por análisis: 2,73 s (mediana de la corrida 6; 2,76 en la 5) × 1 GB × USD 0,0000133334/GB-s + USD 0,0000002 por solicitud | ~USD 0,000037 |
| 10 000 / 30 000 análisis al mes | ~USD 0,37 / ~USD 1,10 (sin capa gratuita) |
| NAT, endpoints, CloudWatch Logs, transferencia | USD 0 (no existen) |

Borrar las imágenes no certificadas (ver Rollback en el README) deja el reposo en ~USD 0,03-0,06.

## Valores para el release (corrida 6)

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | sin definir o `false` (decisión pendiente de Rafael) |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | `arn:aws:lambda:us-east-1:<account>:function:vendix-vex-analysis-sandbox` |
| `AI_ANALYSIS_LAMBDA_REGION` | `us-east-1` |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:ada2b02f1d0001dbb588377aea6abed9e35417f8e89c33b85c1c51d35751fd25` |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | **sin fijar**: esta corrida no certifica. No se tocó ninguna variable del backend |

Cualquier cambio en `Dockerfile`, `requirements.txt`, `handler.py`, `runner.py` o `template.json` cambia el runtime digest y obliga a repetir T53 completa, incluido el experimento de B1.

---

## Historial · corrida 5 (digest `b8868d57…`, runtime `1f10b724…`)

Declarada CERTIFICADA por el autor; la auditoría independiente (64/100) no aceptó el sello: el caso «el invitado detiene o mata al vigilante» no estaba probado (B1), el arnés y los resultados crudos no se conservaron y el punto 6 se llamó «Firma» sin firma (B2). La corrida 6 cierra esos puntos.

| | |
| --- | --- |
| **Resultado (corrida 5)** | **CERTIFICADA.** Pasan los 6 puntos sobre el mismo digest. El hallazgo 7 (enlaces duros en `/tmp`) queda cerrado: los ataques de 15 y 23 s se cortan en 2,0-2,3 s y las tiendas siguientes responden `ok` (27/27). La corrida destapó una variante (hallazgo 8: entradas en la raíz de `/tmp` que reutilizan huecos libres, invisibles al tope de bloques), corregida en `dfb1667be` **antes** de la imagen certificada; toda la evidencia de abajo es sobre esa imagen. `AI_ANALYSIS_CERTIFIED_DIGEST = sha256:1f10b7243591f87e9357b5c3a0fe8d2e11d3f375c7178b4076721d8fd1aa49eb`. |
| Fecha | 2026-11-23, 00:10-00:23 UTC (2026-11-22, 19:10-19:23 Bogotá); intento previo sobre `rt-9c358ee0acb8`, 23:47-00:05 UTC, descartado (hallazgo 8) |
| Cuenta / región | `<account>` / `us-east-1` (perfil `default`), corrida autorizada por el dueño |
| Función | `vendix-vex-analysis-sandbox` (stack `vendix-vex-analysis-stack`) |
| Imagen certificada | `vendix-vex-analysis-runtime@sha256:b8868d575fa38c8dfbbaec40269898a67c27c255f4a5320cb1f4d5b59493d74c` (tag inmutable `rt-1f10b7243591`, `linux/arm64`, manifiesto OCI único) |
| Runtime digest | `sha256:1f10b7243591f87e9357b5c3a0fe8d2e11d3f375c7178b4076721d8fd1aa49eb` (`./runtime-digest.sh` sobre `dfb1667be` = `origin/feat/vex-plus-aws`) |
| Código medido | `11754e911` (tope de 256 KiB de bloques de directorio y limpieza en el sitio) + `dfb1667be` (tope de 64 entradas en la raíz de `/tmp`); se mantienen IPC SysV por tienda, guarda de límites/`nice`/afinidad/planificador y tope de 10 000 inodos (corridas 3 y 4) |
| Despliegue | `update-stack --use-previous-template`, solo `ImageUri` cambiado; actualizó únicamente `AnalysisFunction` (00:09:28-00:09:45Z). `CodeSha256 = b8868d57…d74c`, `LastModified 2026-11-23T00:09:29Z`, `Active`/`Successful` |
| Base | `public.ecr.aws/lambda/python:3.12@sha256:ed196260cbf6f74e3f64dd141ebe2401d78a15e6355925da98a3d3c3b4d35c6a` (sin cambios) |

Higiene: en este documento los IDs de cuenta AWS se sustituyeron por `<account>`; **commits anteriores de la rama todavía contienen el ID completo** (en este archivo y en `infra/ec2-iam/`). No se reescribió la historia: lo decide Rafael.

### Corrida 5 · historia de usuario

**Como** dueño de Vendix en producción, **quiero** que el análisis en Python de Vex corra en una Lambda aislada y certificada **para** encender `AI_ANALYSIS_SANDBOX_ENABLED` sin que el código generado pueda salir a internet, leer credenciales de AWS ni ver, alterar o bloquear el análisis de otra tienda.

**Pasos para probarlo** (consola del operador; el código hostil solo corre dentro de Lambda):

1. Invocar un análisis trivial y ver `status: ok` con el total correcto.
2. Invocar un programa que inunda `/tmp` de enlaces duros durante 15 s y otro durante 23 s (en su directorio y en la raíz de `/tmp`), y justo después tres tiendas.
3. Repetir los programas hostiles de las corridas anteriores (red, Runtime API, `/proc` del padre, memoria/CPU/procesos/disco/inodos, daemon con doble `fork`, límites/`nice`/afinidad/planificador del handler), cada uno seguido de otra tienda.
4. Invocar 100 veces alternando 3 tiendas con residuos sembrados; revisar IAM, red y digests.

**Criterios de aceptación observables:** el atacante de enlaces duros recibe `ANALYSIS_RUNTIME` en menos de 2 s desde que cruza el tope y las tiendas siguientes `ok`; `/tmp` vuelve a sus bloques e inodos; cada programa hostil termina acotado dentro de 25 s; ninguna tienda ve datos de otra; los 6 puntos pasan sobre el mismo digest.

**Lo que se observó:** todos los criterios se cumplen. El atacante responde en 2,0-2,3 s en total (un análisis trivial tarda 2,4 s; cruza el tope a ~0,3 s de empezar), las 27 tiendas posteriores responden `ok` en 2,4-2,5 s y `/tmp` queda en los mismos inodos (147 982) y bloques, salvo 0,1 MB una sola vez en la raíz de `/tmp` (ver hallazgo 8).

### Corrida 5 · resultado por punto (digest `b8868d57…` / runtime `1f10b724…`)

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Egreso cero | **PASA.** `RLIMIT_NOFILE=(0,0)`, descriptores `0-3`; TCP a Runtime API, IMDS, credenciales, proxy DNS, internet, EC2/RDS de producción y NTP, UDP, TCP6, `AF_UNIX`, netlink, `getaddrinfo` → `EMFILE`; raw y `AF_PACKET` → `EPERM`. **R1** (`/runtime/invocation/next`) → `EMFILE`. **R2**: atacante C 19 s, 379/379 `EMFILE` → víctima A `ok`, total correcto, solo su marcador → C otra vez, 40/40 `EMFILE`, solo su marcador. Como ningún socket se abre, el invitado no puede pedir ni contestar invocaciones con un `nonce` ajeno |
| 2 | FS, `/proc` y secretos | **PASA.** Idéntico a la corrida 4: `EROFS` fuera de `/tmp`, `/dev/shm`/`/dev/mqueue` `ENOENT`, `open` → `EMFILE`, `/proc/2/{environ,mem}` de root, `readlink` del padre `EACCES`, `process_vm_readv`/`ptrace`/`unshare`/`seccomp`/`prctl`/`add_key` → `EPERM`, entorno sin `AWS_*`, uid 993 sin capacidades, intérprete `0711`; ataques a `result.json(.part)` → `ANALYSIS_OUTPUT` o `ok` con el resultado propio |
| 3 | Límites de recursos | **PASA.** Enlaces duros 15 s y 23 s (directorio propio y raíz de `/tmp`, 9 ataques) → `ANALYSIS_RUNTIME` en 2,0-2,3 s, 27/27 tiendas siguientes `ok`. Los 17 casos clásicos, 200 000 `mkdir` y el resto de casos de inodos/entradas, y los 8 ataques a los atributos del handler, acotados; sondas siguientes con solo `init` y `/tmp` estable |
| 4 | Multi-tenant (100 × 3 tiendas) | **PASA.** 100/100 en los 16 controles (sobre, `ok`, total, marcador propio, respuesta y log sin marcadores ajenos, symlink/global/daemon/`shm`/`msg`/`sem` de la ejecución anterior ausentes, siembra y control positivo confirmados, keyring `EPERM`) |
| 5 | Política IAM y red | **PASA.** Sin cambios respecto de la corrida 4; drift `IN_SYNC` (0); `simulate-custom-policy` de `backend-invoke-policy.json`: `InvokeFunction` `allowed` solo sobre esta función |
| 6 | Firma y digest | **PASA.** Digest ECR del tag `rt-1f10b7243591` = `CodeSha256` = `ResolvedImageUri` = `Code.ImageUri` = parámetro `ImageUri` = `sha256:b8868d57…d74c`; las 231 respuestas con sobre de la corrida (de 236 invocaciones; las otras 5 son `Runtime.ExitError` buscados: matar al padre, `NOFILE` duro, dos `setpriority` y `SCHED_IDLE`) traen `runtime_digest = sha256:1f10b724…49eb` = `./runtime-digest.sh` en `dfb1667be`. Imagen local verificada antes del push: `ENV ANALYSIS_RUNTIME_DIGEST` igual, `handler.py`/`runner.py` idénticos byte a byte al repo, intérprete `0711` |

### Hallazgo 7 · cerrado

Arreglo aplicado (`11754e911`), las tres opciones propuestas en la corrida 4:

1. **Tope de entradas, no solo de inodos.** Mientras corre el invitado, el padre mide cada 50 ms los bloques que `/tmp` perdió desde el arranque, descuenta lo que el invitado puede escribir legítimamente (stdout/stderr por `fstat` de sus descriptores y el archivo de resultado por nombre) y abona lo que libere de los archivos de la tienda (los mantiene abiertos y mide con `fstat`). Pasados **256 KiB** de bloques de directorio (~16 000 entradas o ~64 directorios) lo mata con `ANALYSIS_RUNTIME "too many files or directories created in the sandbox"`.
2. **Limpieza en el sitio.** `wipe_tmp` recorre cada directorio con `scandir` perezoso: `unlink` relativo al descriptor para lo que no es directorio (tipo por `d_type`, sin `stat`), `rmdir` de los vacíos, baja por descriptor al primer subdirectorio no vacío y sube por `..`. Sin `rename`: ningún directorio crece. Descriptores O(1), sin recursión ni rutas.
3. **Plazo dentro del listado.** Se comprueba por entrada, no entre listados.

Specs nuevos (`TmpEntryTests`, `test_handler.py`): enlaces duros sobre 4 inodos por encima del tope → `ANALYSIS_RUNTIME` en menos de 2 s, `/tmp` vacío, sin `rename`, la tienda siguiente `ok`; truncar la entrada de la tienda para esconder entradas no evade el tope; un resultado legítimo de ~210 KB no se confunde con entradas. RED observado contra `df5bbdf4b` (2 fallan con `ANALYSIS_TIMEOUT`), GREEN después; 58 specs del archivo en verde en macOS. En Linux (dentro de la imagen) pasan los 29 de `TmpEntryTests`, `TmpInodeTests` y `ExecutionTests` con los ganchos solo-Lambda neutralizados; el archivo completo ya fallaba en Linux antes de este cambio (22 de 54 en `df5bbdf4b`: el arnés simula `subprocess.Popen`, que `ctypes.util.find_library` usa en Linux).

### Hallazgo 8 · entradas en la raíz de `/tmp` (encontrado y corregido en esta corrida)

Sobre la primera imagen con el arreglo 7 (`rt-9c358ee0acb8`, digest `2e478671…4ebe`), los ataques en el directorio propio quedaban limpios, pero los que enlazaban **en la raíz de `/tmp`** (abierta a todos, `1777`) le quitaban ~0,3 MB cada uno y cada vez metían más entradas: 4 ataques seguidos respondieron en 2,2 / 2,5 / 2,7 / 3,0 s y `/tmp` bajó de 550,4 a 549,2 MB. Causa: la raíz de `/tmp` es el único directorio que sobrevive a cada ejecución y ext4 no la encoge; las entradas nuevas reutilizan los huecos que dejó el ataque anterior **sin consumir bloques**, así que el tope de bloques no las ve y cada ataque añade 256 KiB más de capacidad (diagnóstico en Lambda: 2 000 enlaces en la raíz ya crecida consumen 0 bloques). Repetido, volvería el `sandbox busy`.

Arreglo (`dfb1667be`): en cada vigilancia el padre cuenta, sin pasar de 65, las entradas de la raíz de `/tmp`; con más de **64** sobre la base mata al invitado con el mismo `ANALYSIS_RUNTIME`. Spec: enlaces en la raíz que no consumen bloques → `ANALYSIS_RUNTIME` en menos de 2 s y `/tmp` vacío (RED contra `11754e911`, GREEN después). Sobre la imagen certificada, 7 ataques seguidos en la raíz responden en 2,0-2,1 s, sin tendencia, y `/tmp` pierde 0,1 MB una sola vez (550,4 → 550,3 MB; 538,3 → 538,2 MB disponibles) y luego se mantiene.

### Evidencia por punto (corrida 5)

Arnés: `boto3` (`invoke` con `LogType=Tail`, `max_attempts=1`, lectura de 90 s) desde un directorio temporal fuera del repo; validación del sobre (`execution_id`, `nonce`, `runtime_digest` esperados) y sondas sin descriptores (`kill(pid, 0)`, `statvfs`, `stat`, `fstat`, `prlimit64` de solo lectura sobre el padre, syscalls por `ctypes`). Ningún programa hostil se ejecutó en la Mac. Primer análisis trivial: **15,2 s de handler en frío**; después, 2,4 s. Identificador de entorno: hora de creación de `/proc/1` y del handler (`ppid = 2`). `/tmp` se informa como bloques libres (`f_bfree`), disponibles (`f_bavail`) e inodos: 550,4 MB / 538,3 MB / 147 982 al empezar (las corridas anteriores daban 513 MB con otra medida).

#### 1 · Egreso cero

Mismas sondas y resultados que la corrida 4 (tabla de la corrida 4 abajo), más: `prlimit64(self, NOFILE, 64)` → `EPERM`; `setrlimit` (1,1)/(0,1)/(1024,1024) → `ValueError`; sigue `(0, 0)`; hijo con `fork` → `EMFILE`; `exec` de `python3` → exit 127. **R1**: `urllib` no puede ni cargar el códec (`EMFILE`). **R2**: C 19 s (379/379 `EMFILE`) → A `ok`, total 6, solo `MARK-A-…` → C 2 s (40/40 `EMFILE`), solo su marcador.

#### 2 · Sistema de archivos, `/proc` y secretos

Mismos resultados que la corrida 4, uno a uno (`mkdir` en 10 rutas de sistema `EROFS`; `/dev/shm`, `/dev/mqueue` `ENOENT`; `truncate`/`chmod`/`rename` de `handler.py`, symlink en `/var/task`, `utime` del intérprete `EROFS`; `open` `EMFILE`; entorno `HOME, LANG, MKL/OMP/OPENBLAS_NUM_THREADS, PATH, PYTHONDONTWRITEBYTECODE, TMPDIR`; uid/euid 993, gid 990, sin grupos, `capget` 0; `/proc/2/{environ,mem}`, `/proc/self/environ`, `/proc/1/environ` de uid 0; `readlink` de `exe`, `cwd`, `root`, `fd/0`, `fd/3` `EACCES`; `result.json.part` symlink → `ANALYSIS_OUTPUT "…cannot be opened safely"`, FIFO y `result.json` directorio → `"…is not a regular file"`, `result.json` symlink previo → `ok` con el resultado propio).

#### 3 · Límites de recursos

Cada caso va seguido de una tienda sonda: en todas, solo `init` y el handler, `/tmp` en 550,3 MB y 147 982 inodos.

| Caso hostil | Respuesta | Handler (s) |
| --- | --- | --- |
| **Enlaces duros 15 s / 23 s en su directorio**, cada uno + tiendas A, B, C | `ANALYSIS_RUNTIME "too many files or directories created in the sandbox"`; A, B, C `ok` (6/6), `/tmp` 550,4 MB, 147 982 inodos | 2,3 / 2,2 |
| **Enlaces duros en la raíz de `/tmp`: 15 s × 1 y 23 s × 6**, cada uno + A, B, C | el mismo `ANALYSIS_RUNTIME`; 21/21 tiendas `ok` (2,4-2,5 s) | 2,0-2,1 |
| `bytearray` 2 GiB / lista sin fin / numpy 30 000² | `ANALYSIS_MEMORY` | 2,5 / 6,3 / 2,4 |
| CPU infinita / `sleep(120)` | `ANALYSIS_TIMEOUT` | 23,0 / 23,0 |
| Fork bomb (hijos dormidos) / exponencial + `setsid` | `ok` (62 hijos, `EAGAIN`) / `ANALYSIS_TIMEOUT` | 3,2 / 23,5 |
| Thread bomb | `ok` (12 hilos) | 2,5 |
| Inundación de stdout / stderr con rutas / 600 MB por el descriptor de resultado | `ANALYSIS_RUNTIME "File too large"` (sin rutas) | 2,4-2,5 |
| Abrir un archivo nuevo en `/tmp` | `ANALYSIS_RUNTIME` con el mensaje del sello | 2,5 |
| Salida de más de 256 KB | `ANALYSIS_OUTPUT` | 2,4 |
| `setsid()` / cerrar el descriptor de resultado | `ANALYSIS_RUNTIME` (`EPERM` / `EBADF`) | 2,4 / 2,5 |
| Matar al padre | `Runtime.ExitError` (falla cerrado); la sonda siguiente, limpia, entorno reiniciado | 2,2 (cliente) |
| Daemon con doble `fork` + `setsid` | control: vivo en su ejecución (pids 9, 10); tienda A siguiente: solo `init` | 3,0 |
| `mkdir` 20 000 / 60 000 / 200 000 / hasta `ENOSPC` | `ANALYSIS_RUNTIME "too many files…"` | 2,0 / 2,1 / 2,0 / 2,0 |
| Cadena `mkdir` + `chdir` / 8 procesos `mkdir` / symlinks largos | el mismo `ANALYSIS_RUNTIME` | 2,2 / 2,1 / 2,1 |
| Enlaces duros a la entrada de la tienda / a un FIFO | el mismo `ANALYSIS_RUNTIME` (antes `ok` con 64 999 enlaces) | 2,3 / 2,3 |

**Atributos del handler.** Tras cada ataque, tres tiendas A, B y C; la sonda lee con `prlimit64`/`getpriority`/`sched_getaffinity`/`sched_getscheduler` el estado del padre: 24/24 `ok` con total y marcador propios y el padre de arranque (`NOFILE (1024, 1024)`, `NPROC (1024, 1024)`, `AS`/`FSIZE`/`CPU` ilimitados, `nice` 0, afinidad `[0, 1]`, `SCHED_OTHER`).

| Ataque | Atacante |
| --- | --- |
| `prlimit` `NOFILE` blando → 4 / varios blandos (`NOFILE`, `AS`, `NPROC`, `FSIZE`, `CPU`) | `ANALYSIS_RUNTIME "too many files or directories created in the sandbox"` (en la corrida 4, `ANALYSIS_OUTPUT`): con `NOFILE` 4 la vigilancia nueva no puede abrir `/tmp` y para al invitado, fallando cerrado; el mensaje no describe la causa |
| `prlimit` `NOFILE` duro → 4 | `Runtime.ExitError` (reinicio en la invocación del atacante) |
| `prlimit` `CPU` blando → 1 s | `ok` |
| `setpriority(ppid, 19)` / `setpriority(PRIO_USER, uid, 19)` | `Runtime.ExitError` / `Runtime.ExitError` |
| `sched_setaffinity(ppid, {0})` | `ok` |
| `sched_setscheduler(ppid, SCHED_IDLE)` | `Runtime.ExitError` |

#### 4 · Aislamiento multi-tenant

100 invocaciones consecutivas A → B → C (34/33/33) con 40, 55 y 70 filas marcadas, 00:18:14-00:23:03Z, todas en el mismo entorno; 2677-2872 ms por análisis (mediana 2757). Cada ejecución busca y luego deja un daemon con doble `fork` + `setsid` y el `shm` adjunto, un symlink `/tmp/vex-t53-plant`, `shm` + `msg` + `sem` con claves fijas y su marcador, una variable en `builtins`, e intenta `add_key`/`keyctl`.

| Comprobación por ejecución | Resultado |
| --- | --- |
| Sobre válido / `status: ok` / total correcto | 100/100 |
| Marcador propio / la respuesta solo trae el propio / log sin marcadores | 100/100 |
| Symlink, variable global, `shm`, `msg` y `sem` de la anterior ausentes (`ENOENT`) / solo `init` / `environ` del padre denegado | 100/100 |
| Siembra confirmada (`msgsnd`, `semctl SETVAL` → 0) y control positivo en la misma ejecución (`shm`, `msg`, `sem` = 930) | 100/100 |
| `/tmp` estable (134 351 bloques, 147 982 inodos) | 100/100 |
| Keyring: `add_key` / `keyctl SEARCH` | `EPERM` / `EPERM` |

#### 5 · Política IAM y red

Solo lectura. Rol de ejecución: confianza solo `lambda.amazonaws.com`, sin boundary, 0 políticas administradas, inline única `VpcEniOnly` (5 acciones ENI sobre `*`). Función sin política de recurso, URL, alias, mapeos, capas ni variables; concurrencia reservada 3; `LoggingConfig` apunta a `/aws/lambda/vendix-vex-analysis-sandbox`, que **no existe** (el rol no tiene permisos de logs). VPC `10.77.0.0/24`: DNS support/hostnames `false/false`, rutas solo `local`, IGW/NAT/endpoints/peering/egress-only/TGW 0, subredes sin IP pública, SG sin ingress y egress solo `127.0.0.1/32` tcp/1. Drift `IN_SYNC` (0 recursos). `simulate-custom-policy` de `backend-invoke-policy.json`: `InvokeFunction` `allowed` sobre esta función e `implicitDeny` sobre otra; `UpdateFunctionCode`, `UpdateFunctionConfiguration` e `InvokeFunctionUrl` `implicitDeny`. La política `vendix-vex-analysis-invoke` no existe (no aplicada).

### Hallazgos operativos (corrida 5)

1. **`numpy 30 000²` sin respuesta (corrida 4): no se reprodujo.** 3 de 3 (una sobre `rt-9c358ee0acb8`, dos sobre la imagen certificada) dieron `ANALYSIS_MEMORY` en 2,3-2,4 s, con la cola del log de la invocación a la vista (`Max Memory Used` 259-335 MB). El log group de CloudWatch **no existe** (por diseño: el rol no puede escribir logs), así que no hay registro del caso original; sigue sin explicar.
2. **Raíz de `/tmp`:** pierde hasta ~0,1 MB una sola vez por entorno si un invitado escribe en ella (hallazgo 8); no crece más con ataques repetidos.
3. **Mensaje engañoso** cuando el invitado baja el `NOFILE` blando del handler: el atacante recibe `too many files or directories…` en vez de un error de límites (falla cerrado; las víctimas no se ven afectadas).
4. **Arranque en frío de 15,2 s** de handler (precarga de scipy/statsmodels antes del sello).
5. **Escaneo de ECR de `rt-1f10b7243591`:** 4 HIGH, 6 MEDIUM, 1 LOW, los mismos conteos que las imágenes anteriores (vienen de la base).
6. **Recursos:** se subieron a ECR `rt-9c358ee0acb8` (descartada, hallazgo 8) y `rt-1f10b7243591` (certificada); el stack se actualizó dos veces, solo `ImageUri`; la función queda en la imagen certificada. Colima se apagó tras cada push y antes de certificar.
7. **Specs en Linux:** `test_handler.py` completo ya fallaba en Linux antes de esta corrida (ver hallazgo 7); se ejecuta en macOS, como indica el README.

### Valores para el release (corrida 5)

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | sin definir o `false` hasta que Rafael decida encenderlo |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | `arn:aws:lambda:us-east-1:<account>:function:vendix-vex-analysis-sandbox` |
| `AI_ANALYSIS_LAMBDA_REGION` | `us-east-1` |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:1f10b7243591f87e9357b5c3a0fe8d2e11d3f375c7178b4076721d8fd1aa49eb` |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | **`sha256:1f10b7243591f87e9357b5c3a0fe8d2e11d3f375c7178b4076721d8fd1aa49eb`** (idéntico al runtime digest; imagen `sha256:b8868d57…d74c`) |

Ninguna variable del backend se tocó en esta corrida. Cualquier cambio en `Dockerfile`, `requirements.txt`, `handler.py`, `runner.py` o `template.json` invalida esta certificación.

---

## Historial · corrida 4 (digest `138825bc…`, runtime `7ae20d6d…`)

| | |
| --- | --- |
| **Resultado (corrida 4)** | **NO CERTIFICADA.** Pasan 1, 2, 4 y 5. **Falla 3**: un invitado que inunda `/tmp` de **enlaces duros** (no consumen inodos, así que el nuevo tope de inodos no los ve) deja tantas entradas que las **6 invocaciones siguientes** de ese entorno, de cualquier tienda, responden `ANALYSIS_RUNTIME "sandbox busy…"` durante unos 2 min (2 de 2). Falla cerrado, sin fuga de datos, pero un programa hostil afecta a las invocaciones siguientes. Los tres arreglos de la corrida 3 funcionan: IPC SysV 0/200 cruces, `prlimit`/`nice`/afinidad/planificador sin efecto sobre la tienda siguiente, `mkdir` masivo acotado en 2,0-4,3 s. `AI_ANALYSIS_CERTIFIED_DIGEST` **no se fija**. |
| Fecha | 2026-11-22, 23:01-23:30 UTC (18:01-18:30 Bogotá) |
| Cuenta / región | `us-east-1` (perfil `default`), corrida autorizada por el dueño |
| Función | `vendix-vex-analysis-sandbox` (stack `vendix-vex-analysis-stack`) |
| Imagen desplegada | `vendix-vex-analysis-runtime@sha256:138825bc02c0e1ed994f5acc82c7d4c9d6349bcaeb5649df6809f6b86fd53870` (tag inmutable `rt-7ae20d6de8db`, `linux/arm64`, subida 17:58:32 Bogotá) |
| Runtime digest | `sha256:7ae20d6de8dbf3b2d816878d3c520f1d647453c3c85fdaa904db4cd85da089cd` (`./runtime-digest.sh` sobre `6e384a3c6`) |
| Código medido | `6e384a3c6` (borrado de IPC SysV antes y después de cada tienda, guarda de límites/`nice`/afinidad/planificador del handler, tope de 10 000 inodos en `/tmp` y limpieza iterativa con plazo) |
| Despliegue | `update-stack --use-previous-template`, solo el parámetro `ImageUri` cambiado; actualizó únicamente `AnalysisFunction` (22:58:58-22:59:15Z). `CodeSha256` `2535679c…` → `138825bc…3870`, `LastModified` `21:59:20Z` → `2026-11-22T22:59:00Z`, `Active`/`Successful` |
| Base | `public.ecr.aws/lambda/python:3.12@sha256:ed196260cbf6f74e3f64dd141ebe2401d78a15e6355925da98a3d3c3b4d35c6a` (sin cambios) |

### Historia de usuario

**Como** dueño de Vendix en producción, **quiero** que el análisis en Python de Vex corra en una Lambda aislada y certificada **para** encender `AI_ANALYSIS_SANDBOX_ENABLED` sin que el código generado pueda salir a internet, leer credenciales de AWS ni ver, alterar o bloquear el análisis de otra tienda.

**Pasos para probarlo** (consola del operador; el código hostil solo corre dentro de Lambda):

1. Invocar un análisis trivial (sumar) y ver la respuesta.
2. Invocar programas hostiles: red (Runtime API e intercepción de la tienda siguiente), escritura fuera de `/tmp`, `/proc` del padre, agotar memoria/CPU/procesos/disco/inodos/entradas de directorio, daemon con doble `fork`, y tocar límites, `nice`, afinidad y planificador del handler; tras cada uno, invocar a otra tienda.
3. Invocar 100 veces alternando 3 tiendas en el mismo entorno caliente; cada ejecución deja residuos (daemon con `shm` adjunto, symlink en `/tmp`, `shm`/`msg`/`sem`, clave en el keyring) y la siguiente los busca.
4. Revisar IAM y red; comparar digests.

**Criterios de aceptación observables:** el análisis trivial responde `status: ok`; cada programa hostil termina con un código acotado dentro del presupuesto de 25 s y sin dejar nada que afecte a la invocación siguiente; ninguna tienda ve datos de otra; los 6 puntos pasan sobre el mismo digest.

**Lo que se observó:** los tres canales de la corrida 3 quedaron cerrados. La tienda siguiente ya no ve IPC SysV de la anterior (0 de 200), el `prlimit` sobre el handler ya no deja el entorno inutilizable (las tiendas A, B y C siguientes responden `ok` en los 8 ataques) y el `mkdir` masivo se corta en 2,0-4,3 s. Pero la inundación de `/tmp` con **enlaces duros** (`link()` no crea inodos ni descriptores) deja ~1 millón de entradas que la limpieza no alcanza a borrar en el plazo: el atacante responde a tiempo, pero la tienda siguiente recibe `sandbox busy` durante ~2 min.

### Corrida 4 · resultado por punto (digest desplegado `138825bc…` / runtime `7ae20d6d…`)

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Egreso cero | **PASA.** Con `RLIMIT_NOFILE=(0,0)`, todo `socket` da `EMFILE` (Runtime API, IMDS, credenciales, proxy DNS, internet, EC2/RDS de producción, NTP, UDP, IPv6, `AF_UNIX`, netlink, `mq_open`); raw y `AF_PACKET` → `EPERM`. **R1** (`GET /runtime/invocation/next`) → `EMFILE`; **R2** (19 s de intentos desde la tienda C) → 379/379 `EMFILE`; la víctima A recibe su total correcto (`duration_ms` 1687) y C no ve el marcador de A. El sello no se puede levantar y lo heredan `fork` y `exec` |
| 2 | FS, `/proc` y secretos | **PASA.** Escrituras fuera de `/tmp` → `EROFS` (`/dev/shm` y `/dev/mqueue` no existen: `ENOENT`); cualquier `open` → `EMFILE`; `/proc/<ppid>/{environ,mem}` de root; `readlink` del padre → `EACCES`; `process_vm_readv` y `ptrace` → `EPERM`; entorno sin `AWS_*`/`LAMBDA_*`; uid 993, capacidades 0; `result.json.part` sustituido por symlink/FIFO y `result.json` directorio → `ANALYSIS_OUTPUT`; `result.json` symlink previo → `ok` con el resultado propio (`os.replace` sustituye el symlink sin seguirlo) |
| 3 | Límites de recursos | **FALLA.** Los 17 casos clásicos, el daemon con doble `fork`, los 7 casos de inodos (hasta 200 000 `mkdir`, hasta `ENOSPC`, cadena con `chdir`, 8 procesos, symlinks) y los 8 ataques a los atributos del handler terminan acotados y sin efecto sobre la tienda siguiente. Falla **un caso nuevo**: **inundación de enlaces duros** (hallazgo 7): 963 000 enlaces en 15 s; el atacante responde en 24,6 s, pero las **6 invocaciones siguientes** responden `ANALYSIS_RUNTIME "sandbox busy: cleanup of a previous run did not finish, retry"` (20 s cada una, sin lanzar al invitado) y la 7.ª vuelve a `ok`: unos 2 min de entorno inutilizable, 2 de 2 |
| 4 | Multi-tenant (100 × 3 tiendas) | **PASA.** 2 tandas de 100 (A/B/C 34/33/33): 200/200 en sobre, `ok`, total, marcador propio, respuesta solo con el propio, log sin marcadores, symlink ausente, sin variables globales, solo `init`, `environ` del padre denegado, `/tmp` estable y **`shm`/`msg`/`sem` de la ejecución anterior ausentes (`ENOENT`)**, con la siembra confirmada (`msgsnd`/`semctl` → 0 en 200/200; control positivo: la misma ejecución lee su `shm`/`msg`/`sem` y la siguiente no). Keyring del usuario: `add_key`/`keyctl` → `EPERM` |
| 5 | Política IAM y red | **PASA.** Rol de confianza solo `lambda.amazonaws.com`, sin boundary ni administradas, inline única `VpcEniOnly` (5 acciones ENI); sin política de recurso, URL, alias, mapeos, capas, variables ni log group; concurrencia reservada 3. VPC con DNS `false/false`, rutas solo `local`, IGW/NAT/endpoints/peering/egress-only/TGW 0, subredes sin IP pública, SG sin ingress y egress solo `127.0.0.1/32` tcp/1. Drift `IN_SYNC` (0). `simulate-custom-policy` de `backend-invoke-policy.json`: `InvokeFunction` permitido solo sobre esta función; `UpdateFunctionCode`/`UpdateFunctionConfiguration`/`InvokeFunctionUrl` y otras funciones → `implicitDeny`; la política `vendix-vex-analysis-invoke` no existe (no aplicada) |
| 6 | Firma y digest | **NO SE FIJA.** La cadena es trazable: digest ECR del tag `rt-7ae20d6de8db` = `CodeSha256` = `ResolvedImageUri` = `Code.ImageUri` = parámetro `ImageUri` = `sha256:138825bc…3870`; las 317 respuestas con sobre del handler (de 323 invocaciones; las otras 6 se explican abajo) traen `runtime_digest = sha256:7ae20d6d…89cd` = `./runtime-digest.sh` en HEAD = `origin/feat/vex-plus-aws`. Imagen local verificada antes del push: `ENV ANALYSIS_RUNTIME_DIGEST` igual, `handler.py`/`runner.py` idénticos byte a byte a los del repo, intérprete `0711`. Falla 3 |

### Hallazgo bloqueante 7 · enlaces duros en `/tmp` (punto 3)

El tope nuevo vigila los **inodos** libres de `/tmp` (`statvfs`). `link()` no crea inodos ni descriptores: añade una entrada de directorio a un inodo existente (hasta 65 000 por inodo, `EMLINK`). El invitado crea un FIFO, lo enlaza 64 000 veces en un directorio propio y repite:

```text
23:09Z  atacante (corta a los 23 s)  -> ANALYSIS_TIMEOUT, duration_ms 24501
        sonda + 5 invocaciones        -> ANALYSIS_RUNTIME "sandbox busy…", 20,0 s cada una, sin lanzar al invitado
        7.ª invocación                -> ok, duration_ms 19516 (terminó de limpiar y ejecutó)
23:27Z  atacante (se detiene a 15 s)  -> ok, 963 000 enlaces en 32 inodos, duration_ms 24596
        6 invocaciones                -> ANALYSIS_RUNTIME "sandbox busy…", 20,0-20,2 s cada una
        7.ª invocación                -> ok, duration_ms 3544 (129 s desde el ataque)
```

Falla cerrado (ningún invitado corre sobre una limpieza incompleta y los datos de la tienda se borran primero), pero un programa hostil deja el entorno inutilizable ~2 min, y con concurrencia reservada 3 tres atacantes bloquean todos los entornos. Además, el atacante de 15 s respondió en **24,6 s**: dentro de los 25 s, pero 96 ms por encima del plazo interno de 24,5 s (un solo listado de 64 000 entradas entre dos comprobaciones del plazo).

**Por qué la limpieza es lenta:** el invitado crea ~64 000 enlaces/s con una syscall cada uno; `wipe_tmp` gasta unas cuatro por entrada (sube cada hijo a `/tmp` con `rename`, buscando un nombre libre con `stat`, y luego `stat` + `unlink`). Ese mismo traslado hace crecer el directorio raíz de `/tmp`, que en ext4 no se encoge: el entorno se queda con 14 MB menos (513 → 499 MB) hasta que Lambda lo recicla.

**Arreglo propuesto (no aplicado):**

1. Acotar las **entradas** además de los inodos: durante la ejecución, el handler mide los bloques que consume `/tmp` (`f_bfree`) menos el tamaño real de stdout/stderr (`fstat` de sus descriptores) y del archivo de resultado; si los bloques de directorio pasan de un tope (por ejemplo, 256 KB, unas 16 000 entradas), mata al invitado con el mismo `ANALYSIS_RUNTIME`.
2. Limpiar más rápido y sin hacer crecer la raíz: en cada directorio, borrar los que no son directorios con `unlink` relativo a su descriptor (tipo por `d_type`, sin `stat`) y subir solo los subdirectorios.
3. Comprobar el plazo dentro del listado, no solo entre entradas.
4. Prueba offline: enlaces duros sobre varios inodos que superan el tope de entradas → `ANALYSIS_RUNTIME` en menos de 2 s y la tienda siguiente `ok`; T53: el mismo ataque de 15 y 23 s seguido de tres tiendas.

### Evidencia por punto (corrida 4)

Arnés: `aws lambda invoke` con `AWS_MAX_ATTEMPTS=1`, `--log-type Tail`, validación del sobre (`execution_id`, `nonce`, `runtime_digest` esperados) y sondas sin descriptores (`stat`, `readlink`, `statvfs`, `kill(pid, 0)`, `fstat`, syscalls por `ctypes`), en un directorio temporal fuera del repo. Ningún programa hostil se ejecutó en la Mac. Calentamiento: el primer análisis trivial tardó **18,7 s de handler en frío**; los siguientes, 1,6 s, `status: ok`, total correcto. Identificador de entorno: hora de creación de `/proc/1` y del handler (`ppid = 2`).

#### 1 · Egreso cero

| Sonda desde el invitado | Resultado |
| --- | --- |
| `RLIMIT_NOFILE` / descriptores abiertos | `(0, 0)` / `0`, `1`, `2`, `3` |
| TCP a `169.254.100.1:9001`, IMDS, `169.254.170.2`, `169.254.100.5:53`, `1.1.1.1:443`, `8.8.8.8:53`, EC2 `<internal-ip>:443`, RDS `<internal-ip>:5432`, NTP `169.254.169.123` | `EMFILE` |
| UDP, TCP6, `AF_UNIX`, netlink / raw, `AF_PACKET` | `EMFILE` / `EPERM` |
| `getaddrinfo('example.com')`; **R1** `urllib` a `/runtime/invocation/next` | `EMFILE` (no puede ni cargar el códec `idna`) |
| **R2** atacante C 19 s → víctima A → atacante C | C: 379 intentos, 379 `EMFILE`; A: `ok`, total esperado, 1687 ms, sin el marcador de C; C: sin el marcador de A |
| Syscalls crudas: `socket` (4 familias), `eventfd2`, `epoll_create1`, `memfd_create`, `userfaultfd`, `openat`, `dup`, `pipe2`, `inotify_init1`, `mq_open` | `EMFILE`; `dup3(1, 0)` → `EBADF`; `bpf` → `EPERM`; `io_uring_setup`, `pidfd_open` → `ENOSYS` |
| Levantar el sello: `setrlimit` (1,1)/(0,1)/(1024,1024); `prlimit64(self, 64)` | `ValueError` / `EPERM`; sigue `(0, 0)` |
| Hijo con `fork` abre un socket; `exec` de `python3 -c socket…` | `EMFILE`; exit 127 |

#### 2 · Sistema de archivos, `/proc` y secretos

| Sonda | Resultado |
| --- | --- |
| `mkdir` en `/var/task`, `/var/runtime`, `/opt`, `/etc`, `/usr/lib`, `/`, `/var/lang/bin`, `/var/tmp`, `/run`, `/home` | `EROFS` |
| `mkdir` en `/dev/shm`, `/dev/mqueue` | `ENOENT` (no existen) |
| `truncate`/`chmod`/`rename` de `handler.py`, symlink en `/var/task`, `utime` del intérprete | `EROFS` |
| `open` de `handler.py` (rw), `core_pattern` (w), `/proc/self/status` | `EMFILE` |
| `mkdir` en el directorio propio de `/tmp` (control) | permitido |
| Entorno del hijo | `HOME, LANG, MKL/OMP/OPENBLAS_NUM_THREADS, PATH, PYTHONDONTWRITEBYTECODE, TMPDIR` |
| Identidad / capacidades | uid/euid 993, gid 990, sin grupos / `capget` 0 |
| Dueño de `/proc/<ppid>/environ`, `/proc/<ppid>/mem`, `/proc/self/environ`, `/proc/1/environ` | uid 0 |
| `open` de `/proc/<ppid>/{environ,mem,maps}` / `readlink` de `exe`, `cwd`, `root`, `fd/0`, `fd/3` | `EMFILE` / `EACCES` |
| Intérprete | `/var/lang/bin/python3.12`, modo `0711` |
| `process_vm_readv(ppid)` 64 bytes, `ptrace(ATTACH)` al padre y a init | `EPERM` |
| `unshare(NEWUSER/NEWNET)`, `seccomp`, `prctl(NO_NEW_PRIVS)` | `EPERM` |
| `result.json.part` → symlink / FIFO; `result.json` directorio; `result.json` symlink previo | `ANALYSIS_OUTPUT "…cannot be opened safely"` / `"…is not a regular file"` / `"…is not a regular file"` / `ok` con el resultado propio (el symlink se sustituye, no se sigue) |

#### 3 · Límites de recursos

Cada caso va seguido de una sonda de estado (procesos visibles, `statvfs` de `/tmp`): en todas, solo `init`, 513 MB libres (499 MB tras el hallazgo 7) y 147 982 inodos libres.

| Caso hostil | Respuesta | Handler (s) |
| --- | --- | --- |
| `bytearray` 2 GiB / lista sin fin | `ANALYSIS_MEMORY` | 1,7 / 4,4 |
| numpy 30 000² | 3 de 4: `ANALYSIS_MEMORY` en 1,7 s. 1 de 4: el cliente no recibió respuesta (lectura agotada a 90 s; ver hallazgos operativos); la sonda siguiente, limpia | 1,7 |
| CPU infinita / `sleep(120)` | `ANALYSIS_TIMEOUT` | 23,0 / 23,0 |
| Fork bomb (hijos dormidos) / exponencial + `setsid` | `ok` (tope `RLIMIT_NPROC`) / `ANALYSIS_TIMEOUT` | 2,8 / 23,5 |
| Thread bomb | `ok` | 1,8 |
| Inundación de stdout / stderr con rutas / 600 MB por el descriptor de resultado | `ANALYSIS_RUNTIME "File too large"` (sin rutas) | 1,7 |
| Abrir un archivo nuevo en `/tmp` | `ANALYSIS_RUNTIME` con el mensaje del sello | 1,7 |
| Salida de más de 256 KB | `ANALYSIS_OUTPUT` | 1,7 |
| `setsid()` / cerrar el descriptor de resultado | `ANALYSIS_RUNTIME` (`EPERM` / `EBADF`) | 1,7 |
| Matar al padre | `Runtime.ExitError` (falla cerrado); la sonda siguiente, limpia | 2,1 (cliente) |
| Daemon con doble `fork` + `setsid` | control: vivo en su ejecución (pid 10, uid 993); tienda A siguiente: solo `init` | — |
| `mkdir` en `/tmp`: 20 000 / 60 000 / 200 000 / hasta `ENOSPC` | `ANALYSIS_RUNTIME "too many files or directories created in the sandbox"` | 2,0 / 2,7 / 3,5 / 3,6 |
| Cadena `mkdir` + `chdir` / 8 procesos haciendo `mkdir` / inundación de symlinks | el mismo `ANALYSIS_RUNTIME` | 4,3 / 3,4 / 1,8 |
| Enlaces duros a la entrada de la tienda / a un FIFO (un inodo) | `ok`; 64 999 enlaces en 0,9 s hasta `EMLINK`; limpiado en el plazo | 3,3 / 3,1 |
| **Enlaces duros sobre muchos inodos** | **atacante acotado (24,5-24,6 s), pero 6 invocaciones siguientes `sandbox busy`, 2 de 2** (hallazgo 7) | — |

**Atributos del handler** (el invitado comparte uid). Tras cada ataque, tres tiendas A, B y C; la sonda de cada víctima lee los límites, `nice`, afinidad y planificador del padre:

| Ataque | Atacante | Víctimas A, B, C | Estado del padre visto por las víctimas |
| --- | --- | --- | --- |
| `prlimit` `NOFILE` blando 1024 → 4 | `ANALYSIS_OUTPUT` (su propio handler no pudo abrir el resultado) | `ok` ×3 | `NOFILE (1024, 1024)`, resto sin cambios |
| `prlimit` blando de `NOFILE`, `AS` (64 MB), `NPROC` (1), `FSIZE` (0), `CPU` (3600 s) | `ANALYSIS_OUTPUT` | `ok` ×3 | de arranque |
| `prlimit` `NOFILE` duro → 4 (irreparable sin privilegios) | `Runtime.ExitError` (el handler reinicia el runtime en la invocación del atacante) | `ok` ×3 (entorno nuevo) | de arranque |
| `prlimit` `CPU` blando → 1 s | `ok` | `ok` ×3 | de arranque |
| `setpriority(ppid, 19)` / `setpriority(PRIO_USER, uid, 19)` | `Runtime.ExitError` (no se puede volver a `nice` 0 sin privilegios) | `ok` ×3 / `ok` ×3 | `nice` 0 |
| `sched_setaffinity(ppid, {0})` | `ok` | `ok` ×3 | afinidad `[0, 1]` restaurada |
| `sched_setscheduler(ppid, SCHED_IDLE)` | `Runtime.ExitError` | `ok` ×3 | `SCHED_OTHER` |

#### 4 · Aislamiento multi-tenant

Dos tandas de 100 invocaciones consecutivas, A → B → C (34/33/33), con 40, 55 y 70 filas marcadas, 23:16:35-23:21:08Z y 23:21:42-23:26:11Z; 1971-2143 ms por análisis (mediana 2069). Las 200 reportan el mismo entorno. Cada ejecución busca y luego deja un daemon con doble `fork` + `setsid` que mantiene el `shm` adjunto, un symlink `/tmp/vex-t53-plant` y `shm` + `msg` + `sem` con claves fijas y su marcador; intenta también `add_key` en el keyring del usuario. La segunda tanda se ejecutó por un error del arnés (se volvió a importar el script); se informa igual.

| Comprobación por ejecución | Tanda 1 | Tanda 2 |
| --- | --- | --- |
| Sobre válido / `status: ok` / total correcto | 100/100 | 100/100 |
| Marcador propio visto / la respuesta solo trae el propio / ningún marcador en el log | 100/100 | 100/100 |
| Symlink de la ejecución anterior ausente / sin variables globales / solo `init` / `environ` del padre denegado | 100/100 | 100/100 |
| `/tmp` estable (499 MB, 147 982 inodos en todas) | 100/100 | 100/100 |
| **`shm` / `msg` / `sem` de la ejecución anterior ausentes (`ENOENT`)** | **100/100** | **100/100** |
| Siembra confirmada (`msgsnd` y `semctl SETVAL` → 0) | 100/100 | 100/100 |
| Keyring: `add_key` / `keyctl SEARCH` | `EPERM` / `EPERM` | `EPERM` / `EPERM` |

Control positivo: una ejecución siembra y relee en la misma ejecución su `shm`, `msg` y `sem` (lee su marcador y el valor 930); la siguiente, de otra tienda, los ve `ENOENT` y solo `init`.

#### 5 · Política IAM y red

Ver la tabla de resultados; todo de solo lectura (`get-role`, `get-role-policy`, `list-*`, `describe-*`, `get-policy`, `simulate-custom-policy`) más una detección de drift del stack.

### Hallazgos operativos (corrida 4)

1. **Una invocación sin respuesta** (`numpy 30 000²`, 23:05:26Z): el cliente agotó su lectura de 90 s sin sobre ni error de Lambda, aunque la función tiene un timeout de 30 s; la sonda siguiente respondió en 1,9 s en el mismo entorno, y las tres repeticiones dieron `ANALYSIS_MEMORY` en 1,7 s. No hay log group para investigarlo (por diseño). No se atribuye al sandbox, pero queda sin explicar.
2. **`/tmp` pierde 14 MB que no vuelven** tras el hallazgo 7 (513 → 499 MB, mismos inodos): el directorio raíz de `/tmp` creció al subir allí las entradas y ext4 no lo encoge. Persiste mientras Lambda no recicle el entorno.
3. **Arranque en frío de 18,7 s** de handler para un análisis trivial (precarga de scipy/statsmodels antes del sello), como en la corrida 3.
4. **Escaneo de ECR de `rt-7ae20d6de8db`:** 4 HIGH, 6 MEDIUM, 1 LOW, los mismos conteos que las imágenes anteriores (vienen de la base).
5. **Recursos:** solo se subió la imagen `rt-7ae20d6de8db` a ECR y se actualizó el parámetro `ImageUri` del stack (más una detección de drift). Un primer `update-stack` falló en el cliente al parsear los parámetros, sin llegar a CloudFormation. Colima se apagó tras el push y antes de certificar.

### Valores para el release (corrida 4)

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | sin definir o `false`. No hay digest certificado |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | ARN de `vendix-vex-analysis-sandbox` en `us-east-1` |
| `AI_ANALYSIS_LAMBDA_REGION` | `us-east-1` |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:7ae20d6de8dbf3b2d816878d3c520f1d647453c3c85fdaa904db4cd85da089cd` (desplegado, **no certificado**) |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | **NO SE FIJA.** T53 falla en el punto 3 |

### Para re-certificar (tras la corrida 4)

1. Acotar las entradas de directorio que crea el invitado (enlaces duros), no solo los inodos, y acelerar la limpieza sin hacer crecer la raíz de `/tmp` (hallazgo 7).
2. Pruebas offline del caso; nuevo runtime digest, imagen `rt-<12 hex>`, `ImageUri` fijado por digest y T53 completa, con R1, R2, IPC SysV, ataques a los atributos del handler, 200 000 `mkdir` y enlaces duros sobre varios inodos (15 y 23 s) seguidos de tres tiendas como casos obligatorios.

---

## Historial · corrida 3 (digest `2535679c…`, runtime `a6e1eade…`)

| | |
| --- | --- |
| **Resultado (corrida 3)** | **NO CERTIFICADA.** Pasan 1, 2 y 5. **Fallan 3 y 4**: un invitado puede dejar marcadores en IPC SysV (`shm`/`msg`) que lee la tienda siguiente (99/100), bajar con `prlimit` los límites del handler y dejar el entorno inutilizable para las tiendas siguientes durante unos 15-19 min, y agotar los inodos de `/tmp` hasta que la invocación muere por `Sandbox.Timedout` a 30 s. `AI_ANALYSIS_CERTIFIED_DIGEST` **no se fija**. |
| Fecha | 2026-11-22, 22:02-22:40 UTC (17:02-17:40 Bogotá) |
| Cuenta / región | `us-east-1` (perfil `default`), corrida autorizada por el dueño |
| Función | `vendix-vex-analysis-sandbox` (stack `vendix-vex-analysis-stack`) |
| Imagen desplegada | `vendix-vex-analysis-runtime@sha256:2535679ca19143d876a3e3a15b62d617a59d086dc71e07077cd355ca9502bfc9` (tag inmutable `rt-a6e1eade84bb`, `linux/arm64`, subida 16:58:37 Bogotá) |
| Runtime digest | `sha256:a6e1eade84bb2ee29b6793c83fa33839f8684f85bc68b3aea4abdcdb80b05c77` (`./runtime-digest.sh` sobre `8e39339b6`) |
| Código medido | `28ac85534` (sello `RLIMIT_NOFILE=(0,0)` antes del código del invitado); `8e39339b6` solo añade documentación |
| Despliegue | `update-stack` con la plantilla previa (igual a `template.json`) y solo el parámetro `ImageUri` cambiado; actualizó únicamente `AnalysisFunction`. `CodeSha256 = 2535679c…bfc9`, `LastModified 2026-11-22T21:59:20Z`, `Active`/`Successful` |
| Base | `public.ecr.aws/lambda/python:3.12@sha256:ed196260cbf6f74e3f64dd141ebe2401d78a15e6355925da98a3d3c3b4d35c6a` (sin cambios) |

### Historia de usuario

**Como** dueño de Vendix en producción, **quiero** que el análisis en Python de Vex corra en una Lambda aislada y certificada **para** encender `AI_ANALYSIS_SANDBOX_ENABLED` sin que el código generado pueda salir a internet, leer credenciales de AWS ni ver, alterar o bloquear el análisis de otra tienda.

**Pasos para probarlo** (consola del operador; el código hostil solo corre dentro de Lambda):

1. Invocar un análisis trivial (sumar 1, 2 y 3) y ver la respuesta.
2. Invocar programas hostiles: red (incluida la Runtime API, `/runtime/invocation/next` y la intercepción de la tienda siguiente), escritura fuera de `/tmp`, `/proc` del padre, agotar memoria/CPU/procesos/disco/inodos, daemon con doble `fork` y tocar los límites del handler.
3. Invocar 100 veces alternando 3 tiendas en el mismo entorno caliente; cada ejecución deja residuos (daemon, symlink en `/tmp`, IPC SysV) y la siguiente los busca.
4. Revisar IAM y red; comparar digests.

**Criterios de aceptación observables:** el análisis trivial responde `status: ok`; cada programa hostil termina con un código acotado dentro del presupuesto de 25 s y sin dejar nada que afecte a la invocación siguiente; ninguna tienda ve datos de otra; los 6 puntos pasan sobre el mismo digest.

**Lo que se observó:** el sello cierra la red por completo (la Runtime API ya no es alcanzable: 377/377 intentos de intercepción dan `EMFILE`) y la tienda A recibe su propio resultado. Pero quedan tres canales que no necesitan descriptores: IPC SysV entre tiendas, `prlimit` sobre el handler y el agotamiento de inodos de `/tmp`.

### Corrida 3 · resultado por punto (digest desplegado `2535679c…` / runtime `a6e1eade…`)

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Egreso cero | **PASA.** Con `RLIMIT_NOFILE=(0,0)`, todo `socket` da `EMFILE` (Runtime API, IMDS, credenciales, proxy DNS, internet, EC2/RDS de producción, NTP, UDP, IPv6, `AF_UNIX`, netlink); raw y `AF_PACKET` → `EPERM`. **R1** (`GET /runtime/invocation/next`) → `EMFILE`; **R2** (19 s de intentos de intercepción desde la tienda C) → 377/377 `EMFILE`, y la víctima A recibe su total correcto, calculado por el handler (`duration_ms` 2395). El sello no se puede levantar y lo heredan los hijos y los `exec` |
| 2 | FS, `/proc` y secretos | **PASA.** `mkdir`/`truncate`/`chmod`/`rename`/`symlink`/`utime` fuera de `/tmp` → `EROFS`; cualquier `open` → `EMFILE`; `/proc/<ppid>/{environ,mem}` de root; `readlink` de `exe`/`cwd`/`root`/`fd` del padre → `EACCES`; `process_vm_readv` y `ptrace` del padre → `EPERM` (64 bytes reales, 4 de 4); entorno del hijo sin `AWS_*`/`LAMBDA_*`; uid 993, capacidades 0; las cuatro variantes de `result.json` (symlink/FIFO antes y después del sello, directorio) → `ANALYSIS_OUTPUT` |
| 3 | Límites de recursos | **FALLA.** 16 de los 17 casos de la lista y el daemon con doble `fork` terminan acotados y sin residuos. Fallan dos: (a) **`prlimit` sobre el handler**: el invitado baja el `RLIMIT_NOFILE` blando del padre (mismo uid) y todas las invocaciones siguientes de ese entorno, de cualquier tienda, responden `ANALYSIS_RUNTIME "sandbox error: OSError"` en 0 ms durante 15-19 min; (b) **llenar `/tmp` de inodos con `mkdir`** (no necesita descriptores) → `Sandbox.Timedout` a 30 s, sin sobre del handler, fuera del presupuesto de 25 s, 4 de 4 veces; la invocación siguiente tarda 6,7-8,9 s más |
| 4 | Multi-tenant (100 × 3 tiendas) | **FALLA.** 11 de 12 controles dan 100/100 (sobre, `ok`, marcador propio, respuesta solo con el propio, total, log, symlink en `/tmp`, variables globales, procesos, `/tmp` estable, `environ` del padre). Pero **IPC SysV**: en 99/100 ejecuciones, la tienda lee por `shm` y `msg` el marcador que dejó la tienda anterior (la primera no tiene anterior). Además, la manipulación de `prlimit` del punto 3 deja a la tienda C bloqueando el análisis de A |
| 5 | Política IAM | **PASA.** Rol de confianza solo `lambda.amazonaws.com`, sin permissions boundary ni administradas, inline única `VpcEniOnly` (5 acciones ENI); sin política de recurso, URL, alias, mapeos, capas, variables ni log group; concurrencia reservada 3. VPC con DNS `false/false`, rutas solo `local`, IGW/NAT/endpoints/peering/egress-only/TGW 0, subredes sin IP pública, SG sin ingress y egress solo `127.0.0.1/32` tcp/1. Drift `IN_SYNC` (0). `simulate-custom-policy` de `backend-invoke-policy.json`: `InvokeFunction` permitido solo sobre esta función; `UpdateFunctionCode`/`UpdateFunctionConfiguration`/`InvokeFunctionUrl` → `implicitDeny`; la política `vendix-vex-analysis-invoke` no existe (no aplicada) |
| 6 | Firma y digest | **NO SE FIJA.** La cadena es trazable: `CodeSha256` = digest ECR del tag `rt-a6e1eade84bb` = `ResolvedImageUri` = parámetro `ImageUri`; las 171 respuestas del handler con sobre válido (de 176 invocaciones; las otras 5 son `Sandbox.Timedout`/`Runtime.ExitError` de Lambda) traen `runtime_digest = sha256:a6e1eade…b05c77` = `./runtime-digest.sh` en HEAD = `origin/feat/vex-plus-aws`. La imagen local se verificó antes del push: `ENV ANALYSIS_RUNTIME_DIGEST` igual, y `handler.py`/`runner.py` dentro de la imagen idénticos byte a byte a los del repo. Fallan 3 y 4 |

### Hallazgo bloqueante 4 · IPC SysV entre tiendas (punto 4)

El sello solo impide **crear descriptores**. `shmget`/`shmat`/`msgget`/`msgsnd`/`semget` devuelven identificadores, no descriptores, y `ctypes` ya está cargado (lo importa numpy). Los objetos IPC son del kernel, no de un proceso: sobreviven a `killpg`, a `kill(-1)` y a la limpieza de `/tmp`. El handler no los borra.

```text
i=0  A  ipc = {shm: ABSENT ENOENT, msg: ABSENT ENOENT}         planta TENANT-A-df1e…
i=1  B  ipc = {shm: TENANT-A-df1e665973cec081, msg: TENANT-A-df1e…}   <- B lee el marcador de A
i=2  C  ipc = {shm: TENANT-B-4275…, msg: TENANT-B-4275…}
...  99/100 con el marcador de la tienda anterior; el symlink en /tmp: 0/100 (lo borra la limpieza)
```

**Impacto:** un invitado de una tienda (por ejemplo, inducido por un prompt incrustado en sus datos) deja datos en memoria del kernel y el invitado de otra tienda los lee después en el mismo entorno caliente. También sirve como canal persistente entre ejecuciones de la misma tienda.

**Arreglo propuesto (no aplicado):** antes de cargar cada tienda y después de matar al invitado, el handler (mismo uid) enumera `/proc/sysvipc/{shm,msg,sem}` y elimina con `IPC_RMID` todo objeto del uid del invitado; si no puede leer o eliminar alguno, falla cerrado. Prueba offline: un invitado que planta `shm`/`msg`/`sem` y una ejecución posterior que los busca.

### Hallazgo bloqueante 5 · el invitado puede bajar los límites del handler (punto 3)

El invitado y el handler comparten uid 993. `prlimit64(ppid, …)` permite **bajar** límites de otro proceso del mismo uid sin capacidades. El invitado bajó el `RLIMIT_NOFILE` blando del handler de 1024 a 4:

```text
22:12Z  prlimit parent      -> parent NOFILE before (1024, 1024), after (4, 1024); su propia respuesta: ANALYSIS_OUTPUT
        next tenant A       -> ANALYSIS_RUNTIME "sandbox error: OSError", duration_ms 1
        6 sondas (0-78 s)   -> idéntico, duration_ms 0
22:17Z  sonda               -> idéntico
22:32Z  (tras 15 min sin invocar) -> status ok: Lambda recicló el entorno
```

Falla cerrado (no se filtran datos), pero un invitado deja inutilizable un entorno para todas las tiendas durante unos 15-19 min, y con concurrencia reservada 3 basta con tres invocaciones para bloquear todos los entornos. Con el mismo mecanismo puede bajar `RLIMIT_AS`, `RLIMIT_NPROC`, `RLIMIT_FSIZE` o `RLIMIT_CPU` del handler.

**Arreglo propuesto (no aplicado):** al inicio de cada invocación, el handler verifica que sus propios límites (`getrlimit`) siguen en los valores de arranque y, si no, termina el proceso (`os._exit`) para que Lambda reinicie el runtime limpio (el caso «matar al padre» ya demuestra que eso falla cerrado y se recupera); más robusto: que el hijo corra con otro uid, lo que exige privilegios que Lambda no da. Prueba: el caso `prlimit parent` seguido de una tienda víctima debe dar el error solo en la invocación del atacante.

### Hallazgo bloqueante 6 · agotar los inodos de `/tmp` rompe el presupuesto (punto 3)

`mkdir` no crea descriptores. El invitado crea unos 3 500 directorios/s; la limpieza posterior de `/tmp` no cabe en la reserva de 2 s:

| Caso | Resultado |
| --- | --- |
| 20 000 `mkdir` | `ok`; invitado 5,6 s, handler 9,5 s en total |
| 60 000 / 200 000 `mkdir` / hasta `ENOSPC` | `Sandbox.Timedout` a 30 s (4 de 4), sin sobre del handler; el backend lo vería como `ANALYSIS_EXPIRED` a 25 s |
| invocación siguiente | `ok`, pero 6,7-8,9 s de handler (el runtime reinicia y limpia lo que quedó); inodos de vuelta en 147 983 |

No se observa fuga de datos ni residuo visible para la tienda siguiente, pero un programa hostil no termina con un código acotado dentro del presupuesto.

**Arreglo propuesto (no aplicado):** acotar la limpieza (borrar el directorio del invitado por renombrado + borrado diferido o con presupuesto de tiempo) y/o limitar las entradas que el invitado puede crear; prueba con 200 000 `mkdir`.

### Evidencia por punto (corrida 3)

Arnés: el de la corrida 2 (`aws lambda invoke`, `AWS_MAX_ATTEMPTS=1`, `--log-type Tail`, validación del sobre contra `execution_id`, `nonce` y `runtime_digest` esperados), con sondas reescritas para no usar descriptores (`stat`, `readlink`, `statvfs`, `kill(pid, 0)`, `fstat`, syscalls por `ctypes`). Ningún programa hostil se ejecutó en la Mac. Calentamiento: el primer análisis trivial tardó **17,8 s de handler en frío** (precarga de scipy/statsmodels, ver hallazgos operativos); los siguientes, 2,2-2,5 s, `status: ok`, `total = 6`.

#### 1 · Egreso cero

| Sonda desde el invitado | Resultado |
| --- | --- |
| Módulos ya cargados | `socket`, `ssl`, `ctypes`, `select`, `urllib.request`, `http.client`, `subprocess`, `threading`, `mmap`: todos presentes (los arrastra pandas/numpy) |
| `RLIMIT_NOFILE` / descriptores abiertos | `(0, 0)` / `0:/dev/null`, `1` y `2` (archivos borrados del handler), `3:<own>/result.json.part` |
| TCP a `169.254.100.1:9001`, IMDS, `169.254.170.2`, `169.254.100.5:53`, `1.1.1.1:443`, `8.8.8.8:53`, EC2 `<internal-ip>:443`, RDS `<internal-ip>:5432`, NTP | `EMFILE` |
| Socket UDP, TCP6, `AF_UNIX`, netlink / raw, `AF_PACKET` | `EMFILE` / `EPERM` |
| `getaddrinfo('example.com')`, `urllib` a la Runtime API | `EMFILE` |
| **R1** `GET /2018-06-01/runtime/invocation/next` | `EMFILE`: no hay conexión, ni evento, ni `nonce` |
| **R2** atacante C 19 s → víctima A → atacante C | C: 377 intentos, 377 `EMFILE`; A: `ok`, total 212 549 = esperado, `duration_ms` 2395; C: sin el marcador de A |
| Syscalls crudas: `socket` (4 familias), `eventfd2`, `epoll_create1`, `memfd_create`, `userfaultfd`, `openat`, `dup`, `pipe2`, `inotify_init1` | `EMFILE`; `dup3(1, 0)` → `EBADF`; `bpf` → `EPERM`; `io_uring_setup`, `pidfd_open` → `ENOSYS` |
| Levantar el sello: `setrlimit` (1,1)/(0,1)/(1024,1024); `prlimit64(self, 64)` | `ValueError` / `EPERM` |
| Hijo con `fork` abre un socket; `exec` de `python3 -c socket…` | `EMFILE`; exit 127 (el intérprete no puede abrir sus archivos) |

#### 2 · Sistema de archivos, `/proc` y secretos

| Sonda | Resultado |
| --- | --- |
| `mkdir` en `/var/task`, `/var/runtime`, `/opt`, `/etc`, `/usr/lib`, `/`, `/var/lang/bin`, `/var/tmp`, `/run`, `/home` | `EROFS` |
| `truncate`/`chmod`/`rename` de `handler.py`, symlink en `/var/task`, `utime` del intérprete | `EROFS` |
| `open` de `handler.py` (rw), `core_pattern` (w), `/proc/self/status` | `EMFILE` |
| `mkdir` en el directorio propio de `/tmp` (control) | permitido |
| Entorno del hijo | `HOME, LANG, MKL/OMP/OPENBLAS_NUM_THREADS, PATH, PYTHONDONTWRITEBYTECODE, TMPDIR`; sin `AWS_*` ni `LAMBDA_*` |
| Identidad | uid/euid 993, gid 990, sin grupos; `capget` eff/prm/inh = 0 |
| Dueño de `/proc/<ppid>/environ`, `/proc/<ppid>/mem`, `/proc/self/environ`, `/proc/1/environ` | uid 0 (no-dumpables) |
| `open` de `/proc/<ppid>/{environ,mem,maps}` / `readlink` de `exe`, `cwd`, `root`, `fd/0`, `fd/3` | `EMFILE` / `EACCES` |
| Intérprete | `/var/lang/bin/python3.12`, modo `0711` |
| `process_vm_readv(ppid)` 64 bytes, `ptrace(ATTACH)` al padre y a init | `EPERM` |
| `unshare(NEWUSER/NEWNET)`, `seccomp`, `prctl` | `EPERM` |
| `result.json.part` sustituido por symlink / FIFO; `result.json` symlink previo / directorio | `ANALYSIS_OUTPUT "result file cannot be opened safely"` / `"…is not a regular file"` / `"…cannot be opened safely"` / `"…is not a regular file"` |

#### 3 · Límites de recursos

Cada caso va seguido de una sonda de estado (procesos visibles por `stat`/`kill(0)` y `statvfs` de `/tmp`); en todas: solo `init`, 513 MB libres (511 tras «cerrar el fd», ver hallazgos operativos), 147 983 inodos libres.

| Caso hostil | Respuesta | Handler (s) |
| --- | --- | --- |
| `bytearray` 2 GiB / lista sin fin / numpy 30 000² | `ANALYSIS_MEMORY` | 2,2 / 2,9 / 2,2 |
| CPU infinita / `sleep(120)` | `ANALYSIS_TIMEOUT` | 23,0 / 23,0 |
| Fork bomb (hijos dormidos) | `ok` (tope `RLIMIT_NPROC`) | 3,4 |
| Fork bomb exponencial + `setsid` | `ANALYSIS_TIMEOUT` | 23,5 |
| Thread bomb | `ok` | 2,3 |
| Inundación de stdout / stderr con rutas | `ANALYSIS_RUNTIME "File too large"` (sin rutas) | 2,3 / 2,4 |
| 600 MB por el descriptor de resultado | `ANALYSIS_RUNTIME "File too large"` | 2,4 |
| Abrir un archivo nuevo en `/tmp` | `ANALYSIS_RUNTIME` con el mensaje del sello | 2,2 |
| Salida de más de 256 KB | `ANALYSIS_OUTPUT` | 2,4 |
| `setsid()` / cerrar el descriptor de resultado | `ANALYSIS_RUNTIME` (`EPERM` / `EBADF`) | 2,4 / 2,4 |
| Matar al padre | `Runtime.ExitError` (falla cerrado); la sonda siguiente, limpia | 2,8 (cliente) |
| Daemon con doble `fork` + `setsid` | control: vivo en su ejecución (pid 10, uid 993); tienda A siguiente y sonda posterior: solo `init` | 3,1 |
| **Llenar `/tmp` de inodos (`mkdir`)** | **`Sandbox.Timedout` 30 s** (hallazgo 6) | — |
| **`prlimit` del handler** | **entorno inutilizable 15-19 min** (hallazgo 5) | — |

#### 4 · Aislamiento multi-tenant

100 invocaciones consecutivas, A → B → C (34/33/33), con 40, 55 y 70 filas marcadas, 22:32:52-22:38:54Z; 2848-3053 ms por análisis (mediana 2953). Las 100 reportan el mismo identificador de entorno (hora de creación de `/proc/1` y del handler, `ppid = 2`; sin `boot_id`, que ya no se puede leer). Cada ejecución deja un daemon con doble `fork` + `setsid`, un symlink `/tmp/vex-t53-plant` y objetos IPC SysV (`shm` + `msg`) con su marcador; la siguiente los busca.

| Comprobación por ejecución | Pasan |
| --- | --- |
| Sobre válido / `status: ok` / total correcto | 100/100 / 100/100 / 100/100 |
| Marcador propio visto / la respuesta solo trae el propio | 100/100 / 100/100 |
| Ningún marcador en el log de la invocación | 100/100 |
| Symlink de la ejecución anterior en `/tmp` | 100/100 ausente |
| Ninguna variable global de la ejecución anterior | 100/100 |
| Ningún proceso de la ejecución anterior (solo `init`) | 100/100 |
| `/tmp` estable (espacio e inodos libres) | 100/100 |
| `/proc/<ppid>/environ` denegado | 100/100 |
| **Ningún marcador ajeno en IPC SysV** | **1/100** (hallazgo 4) |

El control «memoria del padre» de esta tanda usó una sonda defectuosa (`process_vm_readv` con 0 iovecs devuelve 0 sin leer nada); se repitió con 64 bytes reales sobre A, B y C: `EPERM` 3/3, igual que en el punto 2.

#### 5 · Política IAM y red

Ver la tabla de resultados; todo de solo lectura (`get-role`, `get-role-policy`, `get-policy`, `list-*`, `describe-*`, `detect-stack-drift`, `simulate-custom-policy`).

### Hallazgos operativos (corrida 3)

1. **Ejecución paralela en la misma función.** Entre 22:00 y 22:20Z otra sesión ejecutó en paralelo una «corrida 3» sobre la misma función y la publicó en `34d786d10`, con los puntos 2-4 incompletos por un `ANALYSIS_RUNTIME "sandbox error: OSError"` en el preflight. Ese error coincide en hora con la sonda `prlimit parent` de esta corrida (22:12-22:13Z), que bajó el `RLIMIT_NOFILE` del handler: es el hallazgo 5, no un defecto del preflight. Esta sección reemplaza ese informe. Sus mediciones coincidentes (digests, punto 1, `/proc`, IAM, 100 ejecuciones sin cruce de marcadores en las respuestas) se reproducen aquí.
2. **Arranque en frío de 17,8 s** de handler para un análisis trivial (precarga de scipy/statsmodels antes del sello); deja solo 7 s del presupuesto de 25 s. No es de aislamiento, pero conviene medirlo y, si se repite, reducir la precarga o subir memoria.
3. **2 MB de espacio de `/tmp` que no vuelven** tras «cerrar el descriptor de resultado» (513 → 511 MB, mismos inodos libres): probablemente un archivo borrado que sigue abierto en el handler. No se investigó; no es visible para el invitado.
4. **Escaneo de ECR de `rt-a6e1eade84bb`:** 4 HIGH, 6 MEDIUM, 1 LOW: los mismos conteos que las imágenes anteriores (vienen de la base).
5. **Recursos:** solo se subió la imagen `rt-a6e1eade84bb` a ECR y se actualizó el parámetro `ImageUri` del stack (una detección de drift). En el entorno caliente pueden quedar objetos IPC SysV de la prueba con marcadores sintéticos (no son datos reales) hasta que Lambda lo recicle. Colima se apagó tras el push.

### Valores para el release (corrida 3)

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | sin definir o `false`. No hay digest certificado |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | ARN de `vendix-vex-analysis-sandbox` en `us-east-1` |
| `AI_ANALYSIS_LAMBDA_REGION` | `us-east-1` |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:a6e1eade84bb2ee29b6793c83fa33839f8684f85bc68b3aea4abdcdb80b05c77` (desplegado, **no certificado**) |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | **NO SE FIJA.** T53 falla en los puntos 3 y 4 |

### Para re-certificar (tras la corrida 3)

1. Borrar en el handler los objetos IPC SysV del uid del invitado antes y después de cada tienda (hallazgo 4).
2. Detectar en el handler límites propios alterados y reiniciar el runtime (hallazgo 5).
3. Acotar la limpieza de `/tmp` ante agotamiento de inodos (hallazgo 6).
4. Pruebas offline de los tres casos; nuevo runtime digest, imagen `rt-<12 hex>`, `ImageUri` fijado por digest y T53 completa con R1, R2, IPC SysV, `prlimit` del padre y 200 000 `mkdir` como casos obligatorios.

---

## Historial · corrida 2 (digest `35346aa5…`, runtime `3a4f233b…`)

Corrida del mismo día, 19:57-20:12 UTC (14:57-15:12 Bogotá), sobre `e27f50b5b`, imagen `rt-3a4f233be693` (`sha256:35346aa5de5f2bca9749525f31c00ba180571f22dd51ae533191bd95332c67a2`). **NO CERTIFICADA**: fallan los puntos 1 y 4 (Runtime API). Se conserva tal como se publicó.

### Historia de usuario

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

### Resultado por punto (corrida 2), digest desplegado `35346aa5…` / runtime `3a4f233b…`

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Egreso cero | **FALLA.** Toda la red sigue bloqueada (DNS, internet, IMDS, credenciales, VPC y EC2/RDS de producción, raw/`AF_PACKET`), pero la Runtime API de Lambda (`169.254.100.1:9001`) responde al invitado y es explotable (hallazgo bloqueante 3) |
| 2 | FS, `/proc` y secretos | **PASA.** Escritura fuera de `/tmp` → `EROFS`; intérprete `0711`; `/proc/<ppid>/{environ,maps,mem,fd}` de root y denegados; `process_vm_readv` y `ptrace` → `EPERM`; entorno del hijo sin `AWS_*`; symlink y FIFO en `result.json` rechazados. El `nonce` del protocolo sí queda expuesto, pero por la Runtime API (punto 1) |
| 3 | Límites de recursos | **PASA.** 13 casos hostiles, daemon con doble `fork` + `setsid` y matar al padre: códigos acotados, sin procesos ni archivos residuales, siempre en el mismo entorno |
| 4 | Multi-tenant (100 × 3 tiendas) | **FALLA.** El checklist de residuos da 100/100 en los 14 controles, pero la sonda R2 demuestra intercepción entre tiendas: A recibe la respuesta del invitado de C y C recibe el marcador de A |
| 5 | Política IAM | **PASA.** Rol solo ENI; sin política de recurso, URL, alias, mapeos ni logs; la política del backend solo permite `InvokeFunction` sobre este ARN y **no está aplicada** |
| 6 | Firma y digest | **NO SE FIJA.** La identidad es trazable (CodeSha256 = digest ECR = `ImageUri` fijado; `runtime_digest` de todas las respuestas del handler, ~170 invocaciones, = `runtime-digest.sh` de `e27f50b5b`), pero fallan 1 y 4 |

### Hallazgo bloqueante 3 · el invitado secuestra la Runtime API de Lambda

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

### Evidencia por punto (corrida 2)

Arnés: `aws lambda invoke` con `AWS_MAX_ATTEMPTS=1` (un intento, sin reintentos) y `--log-type Tail` desde la Mac del operador; ningún programa hostil se ejecutó en la Mac. Cada respuesta se validó contra el sobre (`vendix.analysis/v1`, `execution_id`, `nonce` y `runtime_digest` esperados): **todas las respuestas del handler pasan**, y también las falsificadas por R2. Calentamiento: 3 invocaciones triviales, `status: ok`, `total = 6`, 2122-2159 ms. Las invocaciones secuenciales caen en el mismo entorno caliente (`boot_id 70a2903a`, runtime pid 2 / ppid 0); una sonda aislada cayó en un segundo entorno (`828f582a`), también limpio.

#### 1 · Egreso cero

| Destino | Resultado |
| --- | --- |
| `resolv.conf` del invitado | `nameserver 169.254.100.5`, `timeout:2 attempts:5` |
| DNS: `example.com`, subdominio aleatorio, `sts.amazonaws.com`, `lambda.us-east-1.amazonaws.com`, endpoint RDS de producción | BLOCKED (sin respuesta en 12 s) |
| UDP/53 a `10.77.0.2`, `169.254.169.253`, `169.254.100.5`, `8.8.8.8`, `1.1.1.1`, `<internal-ip>` | BLOCKED (timeout) |
| TCP a `1.1.1.1` (53/80/443) y `8.8.8.8` (53/443); `https://example.com/` | BLOCKED (timeout) |
| IPv6 `2606:4700:4700::1111:443` | BLOCKED (`EADDRNOTAVAIL`) |
| IMDS `169.254.169.254` (TCP, HTTP v1, token v2), credenciales `169.254.170.2` | BLOCKED (`ECONNREFUSED`) |
| NTP `169.254.169.123:123` | BLOCKED (`EPERM`) |
| EC2 de producción `<internal-ip>` (22/80/443/3000), RDS `<internal-ip>:5432`, IP pública de la EC2 `:443` | BLOCKED (timeout) |
| `SOCK_RAW` ICMP, `AF_PACKET` | BLOCKED (`EPERM`) |
| TCP `169.254.100.5:53` (proxy DNS local) | conecta, no responde |
| **TCP `169.254.100.1:9001` (Runtime API)** | **abierto y explotable: R1 y R2** |

#### 2 · Sistema de archivos, `/proc` y secretos

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

#### 3 · Límites de recursos

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

#### 4 · Aislamiento multi-tenant

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

#### 5 · Política IAM (digest desplegado)

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

| Acción | `vendix-vex-analysis-sandbox` | `<otra-función-de-producción>` | otra función del prefijo |
| --- | --- | --- | --- |
| `lambda:InvokeFunction` | **allowed** | implicitDeny | implicitDeny |
| `lambda:UpdateFunctionCode` | implicitDeny | implicitDeny | implicitDeny |
| `lambda:UpdateFunctionConfiguration` | implicitDeny | implicitDeny | implicitDeny |
| `lambda:InvokeFunctionUrl` | implicitDeny | implicitDeny | implicitDeny |

#### 6 · Identidad del digest

| Fuente | Valor |
| --- | --- |
| `Configuration.CodeSha256` | `35346aa5de5f2bca9749525f31c00ba180571f22dd51ae533191bd95332c67a2` |
| Digest en ECR del tag `rt-3a4f233be693` (repositorio IMMUTABLE, scan on push, AES256) | `sha256:35346aa5…67a2` |
| `Code.ImageUri` / `ResolvedImageUri` / parámetro `ImageUri` del stack | `…/vendix-vex-analysis-runtime@sha256:35346aa5…67a2` (fijado por digest) |
| `runtime_digest` en todas las respuestas | `sha256:3a4f233be693ab7e00a02724b9db9fd619148b15ce485cfc7701b9ca8114168e` |
| `./runtime-digest.sh` sobre `e27f50b5b` (HEAD y `origin/feat/vex-plus-aws`) | `sha256:3a4f233be693ab7e00a02724b9db9fd619148b15ce485cfc7701b9ca8114168e` |

La cadena es trazable de punta a punta, pero el digest no se certifica: fallan los puntos 1 y 4.

### Hallazgos operativos (corrida 2, no bloquean por sí solos)

1. **Arranque en frío:** no se repitió; la primera invocación respondió en 2,2 s (la imagen ya estaba cargada por la corrida interrumpida).
2. **Matar al padre** reinicia el runtime dentro de la misma microVM (mismo `boot_id`, pid desde 5), no necesariamente un entorno nuevo; el `kill(-1)` previo a cada tienda cubre ese caso y la sonda siguiente lo confirma. La sonda R2 también provocó un reinicio del runtime.
3. **Escaneo de ECR de `rt-3a4f233be693`:** 4 HIGH (`CVE-2026-95520` y `CVE-2026-95521` en `rpm`/`rpm-libs 4.16.1.3`), 6 MEDIUM (`sqlite-libs 3.40.0`), 1 LOW. Vienen de la imagen base (los mismos conteos que `rt-0a0ed8a9655b`) y no forman parte de T53; conviene revisarlos al rehacer la imagen.
4. **Código posterior a lo medido:** durante la corrida otra sesión commiteó localmente `28ac85534` (`handler.py`, `runner.py`, `test_runner.py`, `README.md`). Lo medido es exactamente `e27f50b5b`; desde `28ac85534` el repo calcula otro runtime digest y la T53 de esta corrida no lo cubre.
5. **Recursos:** no se creó, modificó ni borró ningún recurso en esta corrida (solo invocaciones y lecturas; una detección de drift del stack). La imagen `rt-0a0ed8a9655b` de la corrida 1 sigue en ECR.

### Valores para el release (corrida 2)

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | sin definir o `false`. No hay digest certificado |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | `arn:aws:lambda:us-east-1:<account>:function:vendix-vex-analysis-sandbox` |
| `AI_ANALYSIS_LAMBDA_REGION` | `us-east-1` |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:3a4f233be693ab7e00a02724b9db9fd619148b15ce485cfc7701b9ca8114168e` (desplegado, **no certificado**) |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | **NO SE FIJA.** T53 falla en los puntos 1 y 4. Sin este valor el backend mantiene la feature apagada |

La política del backend, el comando para adjuntarla y el costo estimado no cambian respecto de la corrida 1 (ver historial); la política sigue sin aplicarse.

### Para re-certificar (tras la corrida 2)

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
| Cuenta / región | `<account>` / `us-east-1` (perfil `default`), corrida autorizada por el dueño |
| Función | `arn:aws:lambda:us-east-1:<account>:function:vendix-vex-analysis-sandbox` |
| Imagen desplegada | `<account>.dkr.ecr.us-east-1.amazonaws.com/vendix-vex-analysis-runtime@sha256:c5aca9a06436e81e8ad5d10a7a5244504a5e2699b14565c275ef93cea105d6f5` (tag inmutable `rt-0a0ed8a9655b`, `linux/arm64`) |
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
| Repositorio ECR (IMMUTABLE, scan on push, AES256) | `arn:aws:ecr:us-east-1:<account>:repository/vendix-vex-analysis-runtime` |
| Stack CloudFormation (desde `template.json`) | `vendix-vex-analysis-stack` |
| VPC `10.77.0.0/24`, DNS support/hostnames **false** | `<vpc-id>` |
| Subredes privadas (`MapPublicIpOnLaunch=false`) | `<subnet-id>` (1a), `<subnet-id>` (1b) |
| Tabla de rutas (solo `local`) | `rtb-0b86b1aebcb136966` |
| Security group (sin ingress; egress solo `127.0.0.1/32` tcp/1) | `<sg-id>` |
| Rol de ejecución (solo ENI) | `<role>` |
| Función (arm64, 1024 MB, 30 s, `/tmp` 512 MB, concurrencia reservada 3, sin variables de entorno) | `arn:aws:lambda:us-east-1:<account>:function:vendix-vex-analysis-sandbox` |

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
| IP privada de la EC2 de producción (22/80/443/3000), IP privada del RDS de producción (5432), VPC por defecto `<internal-ip>:53` | BLOCKED (timeout) |
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

| Acción | `vendix-vex-analysis-sandbox` | `<otra-función-de-producción>` | otra función del prefijo |
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
      "Resource": "arn:aws:lambda:us-east-1:<account>:function:vendix-vex-analysis-sandbox"
    }
  ]
}
```

Comando para adjuntarla al rol de la instancia de producción, como política administrada nueva (el mismo patrón que las demás políticas de ese rol), **solo cuando el digest esté certificado**:

```bash
sed 's/<REGION>/us-east-1/; s/<ACCOUNT_ID>/<account>/' \
  infra/agent-sandbox/python/backend-invoke-policy.json > /tmp/vendix-vex-analysis-invoke.json
aws iam create-policy --policy-name vendix-vex-analysis-invoke \
  --policy-document file:///tmp/vendix-vex-analysis-invoke.json
aws iam attach-role-policy --role-name vendix-ec2-production-role \
  --policy-arn arn:aws:iam::<account>:policy/vendix-vex-analysis-invoke
rm /tmp/vendix-vex-analysis-invoke.json
```

Si el `.env` de producción define `AWS_ACCESS_KEY_ID`, el SDK usa ese usuario IAM antes que el rol de la instancia: en ese caso la política va en ese usuario, no en el rol.

### Valores para el release

| Variable | Valor |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | `true` (solo cuando exista un digest certificado; hoy debe quedar sin definir o en `false`) |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | `arn:aws:lambda:us-east-1:<account>:function:vendix-vex-analysis-sandbox` |
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
