# Sandbox de análisis en Python sobre AWS Lambda aislada (F9 · D3)

**Estado (2026-11-23): desplegada en la cuenta de Vendix (`us-east-1`) como `vendix-vex-analysis-sandbox`, APAGADA y NO CERTIFICADA, pendiente de decisión del dueño.** T53 corrida 6 sobre la imagen `sha256:b62b6f9f…015b` (runtime digest `sha256:ada2b02f1d0001dbb588377aea6abed9e35417f8e89c33b85c1c51d35751fd25`): pasan los puntos 1, 2, 4, 5 y 6; en el 3 todos los topes pasan, pero el invitado puede detener al vigilante (auditoría independiente, B1) y queda un riesgo de disponibilidad medido. Ver [`CERTIFICACION-T53.md`](CERTIFICACION-T53.md), «Decisión pendiente de Rafael». `AI_ANALYSIS_CERTIFIED_DIGEST` no se fija.

La infraestructura solo la despliega un operador con autorización explícita; nunca se ejecuta código del invitado en una máquina de desarrollo. El backend y sus workers **nunca** ejecutan código generado por IA en el host: el worker solo orquesta la cola, materializa tablas de la misma conversación, invoca la Lambda con `lambda:InvokeFunction`, valida el JSON de salida y persiste bloques (`table`, `chart`, `kpi`).

---

## Arquitectura (Decisión D3)

```text
NestJS (API / worker ai-agent) — autoridad vigente, plan, admisión y auditoría cifrada
   │  RequestResponse JSON (protocolo vendix.analysis/v1, nonce 64 hex, sin secretos)
   │  política IAM mínima: backend-invoke-policy.json (solo lambda:InvokeFunction a 1 ARN)
   ▼
AWS Lambda (imagen contenedor Python 3.12 · Dockerfile + template.json)
   ├── VPC dedicada con subredes privadas únicamente (sin IGW, sin NAT, sin VPC endpoints)
   │   y resolvedor DNS de la VPC deshabilitado (los security groups no filtran el DNS de Amazon)
   ├── Security group sin ingress y sin egress real (regla loopback reemplaza allow-all)
   ├── Rol IAM limitado exclusivamente a gestión de ENI para adjuntar la Lambda a la VPC
   ├── Código en LAMBDA_TASK_ROOT de solo lectura (chmod a-w); solo /tmp escribible
   └── Por cada invocación (handler.py → runner.py):
          1. Valida petición y recorta límites contra HARD_LIMITS.
          2. Antes de cada tienda y después de cada ejecución: borra los objetos IPC SysV (`shm`/`msg`/`sem`) del uid del invitado y comprueba que no queda ninguno (falla cerrado), y limpia /tmp de forma iterativa y con plazo (si la limpieza de una ejecución anterior no terminó, la invocación responde `sandbox busy` sin lanzar al invitado).
          3. Exige que el proceso padre sea no-dumpable (ver abajo) para impedir que el hijo lea `/proc/<ppid>/environ`, `mem`, `maps` o `fd`, use `process_vm_readv` o haga `ptrace`, y lanza un proceso hijo nuevo (`python -I runner.py`) en sesión propia con entorno limpio (sin `AWS_*`), `RLIMIT_AS` / `RLIMIT_CPU` / `RLIMIT_NPROC` / `RLIMIT_FSIZE` / `RLIMIT_CORE` y timeout de pared.
          4. El hijo importa y precarga sus módulos, carga los datos y abre su archivo de resultado; justo antes de ejecutar el código del invitado baja `RLIMIT_NOFILE` a `(0, 0)` y comprueba que ya no puede crear descriptores (ver abajo). Si no lo consigue, falla cerrado sin ejecutar al invitado.
          5. El hijo recibe `wall_ms` menos una reserva de 2 s, para que la respuesta (incluida la limpieza) llegue antes de que el backend aborte a `wall_ms` exactos: un análisis que agota el tiempo llega como `ANALYSIS_TIMEOUT`, no como `ANALYSIS_EXPIRED`.
          6. Mata todo el grupo de procesos (`SIGKILL`) al terminar o vencer el tiempo y, después, a todo superviviente del uid del invitado (`kill(-1, SIGKILL)`); lo mismo antes de cargar los datos de cada tienda.
          6b. Mientras corre el invitado vigila /tmp cada 50 ms y lo mata si crea más de 10 000 inodos, más de 256 KiB de bloques de directorio (enlaces duros: entradas sin inodo) o más de 64 entradas en la raíz de /tmp (`mkdir`/`symlink`/`link` no necesitan descriptores), para que la limpieza, en el sitio y con plazo, quepa en la reserva.
          6c. Compara sus propios límites (`RLIMIT_*`), `nice`, afinidad y planificador con una **tabla fija** de los valores que da Lambda (medidos en T53, corrida 6), nunca con lo observado al importar: el invitado comparte uid y puede cambiarlos con `prlimit`/`setpriority`/`sched_*`. Lo hace tras el `kill(-1)` del principio de cada invocación, en cada vigilancia de 50 ms mientras corre el invitado y tras la limpieza posterior. Restaura lo que puede; si no (un límite duro bajado, un `nice` subido), termina el proceso para que Lambda reinicie el runtime en la invocación del atacante, no en la de la tienda siguiente.
          6d. Antes de cada invitado comprueba que `/tmp` sigue siendo el directorio de root `1777` sin atributos extendidos (el invitado no puede cambiarlo en Lambda: `EPERM`); si no, falla cerrado.
          7. Lee `result.json` con `O_NOFOLLOW`, revalida `result` (tables/series/figures/notes) y devuelve solo JSON acotado.
```

### Lo que el handler no puede impedir: que el invitado lo detenga (auditoría independiente, B1)

Todos los topes del paso 6b los aplica el proceso padre, y el invitado comparte su uid: puede enviarle `SIGSTOP` (o `SIGKILL`). En Lambda no hay un segundo uid, ni `seccomp()` propio, ni `prctl`, ni espacios de nombres, así que nada lo impide. Con el vigilante detenido, el invitado trabaja sin topes hasta el tiempo máximo de la función (30 s); entonces Lambda da `Sandbox.Timedout`, **reinicia el entorno** (proceso `init` nuevo, ningún proceso del invitado sobrevive) y **conserva `/tmp`**. Lo que queda es un riesgo de **disponibilidad**, no de fuga: el entorno nuevo arranca sin datos de ninguna tienda y el handler limpia lo que el atacante dejó antes de lanzar a nadie.

El handler acota ese coste: mata supervivientes y fija su estado contra la tabla de Lambda en INIT (antes de la primera invocación del runtime nuevo) y al principio de cada invocación; limpia `/tmp` en INIT hasta 7 s y luego como mucho 2 s por invocación, respondiendo `sandbox busy` en lugar de hacer esperar a la tienda. El coste medido por ataque y el tiempo de recuperación están en `CERTIFICACION-T53.md` (corrida 6, B1).

### Por qué el intérprete es solo-ejecución (paso 3)

El hijo corre con el mismo uid que el handler, y el handler tiene en su entorno y en su memoria las credenciales temporales del rol y los datos de la invocación. Lo que impide leerlas es que el padre sea **no-dumpable**: el kernel pasa entonces los inodos de `/proc/<pid>` a root y niega `process_vm_readv` y `ptrace`.

La vía normal es `prctl(PR_SET_DUMPABLE, 0)`, pero el perfil seccomp de Lambda deniega **todo** `prctl` con `EPERM` (T53, primera corrida: el 100 % de las ejecuciones fallaba cerrado). Tolerar ese error a ciegas dejaba legibles `/proc/<ppid>/environ` (nombres `AWS_*`) y el heap del padre, donde aparecía el marcador de la tienda anterior (8 de 9 respuestas cruzadas).

Por eso el `Dockerfile` deja `/var/lang/bin/python3.12` en `0711`: al ejecutar un binario que el usuario no puede leer, el kernel marca el proceso como no-dumpable sin necesidad de `prctl`, tanto al runtime de Lambda (y con él al handler) como a cada hijo. `handler.py` intenta `prctl` primero y acepta el `EPERM` **solo** si comprueba que el kernel ya lo marcó (`/proc/self/environ` es de root siendo el proceso no-root); con cualquier otro errno, o sin esa prueba, falla cerrado sin lanzar al hijo ni escribir datos de la tienda.

### Por qué el invitado no puede crear descriptores (paso 4)

La Runtime API de Lambda (`169.254.100.1:9001`) vive dentro de la microVM: ningún security group, ruta ni NACL la filtra, y no pide autenticación. En T53 (segunda corrida, sobre el digest que ya traía los arreglos de `prctl` y `kill(-1)`) un invitado de la tienda C abrió un socket TCP a esa API, pidió su propia invocación (`GET /runtime/invocation/next` devuelve el evento en curso, con su `nonce`), publicó una respuesta falsificada con un sobre válido y se quedó escuchando: Lambda dio la invocación por terminada y le entregó al invitado, todavía vivo dentro del handler, la invocación siguiente de la tienda A. El invitado la respondió y luego devolvió el marcador de A en la respuesta de C.

Las barreras habituales no existen en Lambda: el perfil seccomp deniega la syscall `seccomp` (no hay filtro propio posible) y `unshare` (no hay espacio de red vacío). Lo que sí existe es `RLIMIT_NOFILE`. Con límite blando y duro en 0, toda syscall que crea un descriptor (`socket`, `open`, `pipe`, `dup`, `memfd_create`, `eventfd`, `epoll`, `pidfd_open`…) falla con `EMFILE`; el invitado no puede volver a subirlo (no tiene `CAP_SYS_RESOURCE`) y los descriptores ya abiertos (stdio y el archivo de resultado) siguen funcionando. `exec` del intérprete e `import` de pandas necesitan descriptores, por eso el sellado lo hace `runner.py` justo antes del código del invitado y no el `preexec_fn` del handler.

Consecuencia para el código generado (coherente con su contrato: «`pd`, `np` y `sm` ya están disponibles; sin imports de red, sin archivos»): no puede abrir archivos, lanzar procesos ni importar módulos que no estén ya cargados. `runner.py` precarga la biblioteca estándar de cálculo (`math`, `statistics`, `datetime`, `decimal`, `collections`…), `scipy.stats`/`optimize`/`interpolate`, `statsmodels.formula.api`/`tsa.api`, `dateutil`, `pytz`, y calienta las zonas `UTC` y `America/Bogota`. Si el invitado choca con el sello recibe `ANALYSIS_RUNTIME` con un mensaje que lo explica, y el modelo tiene una corrección.

### Por qué `kill(-1)` además de matar el grupo (paso 6)

`killpg` solo alcanza al grupo del hijo. Un invitado que hace doble `fork` + `setsid` deja un daemon en otra sesión que sobrevive a la invocación. En T53 (primera corrida) ese daemon quedó escuchando en un socket abstracto, leyó desde `/tmp` los datos de la tienda siguiente y se los entregó a la ejecución posterior.

Dentro de Lambda el handler es la tarea superior de su espacio de PIDs (`ppid 0`) y solo comparte uid con procesos del invitado (la función no tiene capas ni extensiones). Por eso `kill(-1, SIGKILL)` (toda tarea que podemos señalar salvo nosotros mismos e init) elimina a cualquier superviviente: el kernel lo aplica bajo el lock de la lista de tareas, sin carrera con `fork`, y `SIGKILL` no se puede capturar. El handler lo ejecuta en INIT (al importar, antes de la primera invocación del runtime), **al principio** de cada invocación (antes de validarla, de fijar su estado, de limpiar `/tmp` y de escribir los datos de la tienda), y otra vez tras matar el grupo del hijo. Fuera de ese espacio de PIDs (una Mac de desarrollo) se niega y la invocación falla cerrada; las pruebas offline siempre lo simulan.

---

## Construcción y despliegue de la imagen (operador)

1. **Lockfile con hashes, generado dentro de la base fijada** (mismo Python y plataforma que Lambda): `requirements.in` lista los pines directos; `requirements.txt` sale de `pip-compile --generate-hashes --strip-extras requirements.in` ejecutado en `public.ecr.aws/lambda/python:3.12@sha256:…` (`linux/arm64`). `pip install --require-hashes` falla cerrado si algo no coincide.
2. **Identidad del runtime:** `./runtime-digest.sh` imprime `sha256:` sobre Dockerfile, lockfile, `handler.py`, `runner.py` y `template.json` (mismo valor en macOS y Linux). `template.json` no va dentro de la imagen, pero cubrirlo hace que cualquier cambio de red, memoria, tiempo o rol produzca otro digest y obligue a reconstruir y a repetir T53. Un cambio aplicado en AWS sin pasar por el repo no lo detecta el digest: lo detectan la detección de drift de CloudFormation y el `sha256` de `template.json` registrado en la certificación. Se pasa como `--build-arg ANALYSIS_RUNTIME_DIGEST=…` y es el valor de `AI_ANALYSIS_RUNTIME_DIGEST`.
3. **Build `linux/arm64`** (la arquitectura del template: Graviton, ~20 % más barato por GB-s y la base oficial publica manifiesto arm64). Usar el builder clásico (`DOCKER_BUILDKIT=0`) o `buildx --provenance=false`: Lambda rechaza índices de imagen con atestaciones.
4. **ECR inmutable** `vendix-vex-analysis-runtime`, tag `rt-<12 hex del runtime digest>`; el stack recibe `ImageUri` fijado por digest (`…@sha256:…`), nunca por tag.
5. Cualquier cambio en estos archivos o en `template.json` cambia el runtime digest, invalida la certificación y reabre T53, incluido el experimento de B1.

---

## Interruptor apagado por defecto

`SandboxLambdaClientService.configuration()` devuelve `null` (feature apagada; Vex responde que el análisis avanzado no está disponible y usa `compute`) salvo que **todas** estas variables estén configuradas y sean consistentes:

| Variable | Requisito |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | Exactamente `'true'` |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | ARN concreto de una función Lambda (sin comodines) |
| `AI_ANALYSIS_LAMBDA_REGION` | Región AWS válida que coincide con la del ARN |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:<64 hex>` inyectado en la imagen construida |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | `sha256:<64 hex>` **idéntico** a `AI_ANALYSIS_RUNTIME_DIGEST`, fijado solo tras completar T53 |

Además, el backend requiere `SandboxAuditRepository.sourceAvailable()` (cifrado de fuente en `ai_agent_script_runs`), `@aws-sdk/client-lambda` (dependencia de `apps/backend`; se carga en tiempo de ejecución), Redis para la ranura de 1 análisis simultáneo por tienda y la capacidad de plan `vex.code_analysis` activa para la tienda.

**Encendido en producción:** checklist ordenado (permiso `lambda:InvokeFunction`, las 5 variables, verificación con Vex y rollback) en la sección «Encendido en el release» de `CERTIFICACION-T53.md`.

---

## Pruebas offline (sin AWS ni ejecución hostil en Mac)

```bash
node --test infra/agent-sandbox/python/template.test.cjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
  infra/agent-sandbox/python/test_runner.py \
  infra/agent-sandbox/python/test_handler.py -v
```

CI: `.github/workflows/agent-sandbox-python.yml` corre `test_runner` y `test_handler` en Linux (Python 3.12) en cada PR que toque este directorio; en local, una clase o archivo por invocación.

Las pruebas de `handler.py` mockean `subprocess.Popen` y validan limpieza de `/tmp`, variables de entorno del hijo, códigos de error, truncado de mensajes y validación estricta. Las de `runner.py` ejecutan el sellado de descriptores real en un subproceso con pandas/numpy simulados y programas de prueba benignos. Estas pruebas **no** certifican el aislamiento real de AWS.

---

## Rollback

1. **Apagar (inmediato, sin tocar AWS):** quitar `AI_ANALYSIS_SANDBOX_ENABLED` (o dejarlo distinto de `'true'`) en el backend y reiniciarlo. `configuration()` devuelve `null` y Vex vuelve a `compute`.
2. **Volver a una imagen anterior:** actualizar solo el parámetro `ImageUri` del stack con el digest de la imagen certificada anterior y fijar `AI_ANALYSIS_RUNTIME_DIGEST`/`AI_ANALYSIS_CERTIFIED_DIGEST` a su runtime digest:
   `aws cloudformation update-stack --stack-name vendix-vex-analysis-stack --use-previous-template --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM --parameters ParameterKey=ImageUri,ParameterValue=<account>.dkr.ecr.us-east-1.amazonaws.com/vendix-vex-analysis-runtime@sha256:<digest> ParameterKey=FunctionName,UsePreviousValue=true ParameterKey=ReservedConcurrency,UsePreviousValue=true ParameterKey=Architecture,UsePreviousValue=true ParameterKey=VpcCidr,UsePreviousValue=true ParameterKey=SubnetACidr,UsePreviousValue=true ParameterKey=SubnetBCidr,UsePreviousValue=true`.
   Solo imágenes con una corrida T53 certificada; las demás no se usan.
3. **Retirar del todo:** con la feature apagada, `aws cloudformation delete-stack --stack-name vendix-vex-analysis-stack` (borra función, VPC, subredes, SG y rol; no hay datos) y después las imágenes: `aws ecr batch-delete-image --repository-name vendix-vex-analysis-runtime --image-ids imageTag=rt-…` y, si no queda ninguna, `aws ecr delete-repository --repository-name vendix-vex-analysis-runtime`.
4. **Imágenes que sobran hoy:** todas las `rt-*` salvo la desplegada (`rt-ada2b02f1d00`, corrida 6) y, como vuelta atrás, la de la corrida 5 (`rt-1f10b7243591`); ver «Recursos» en `CERTIFICACION-T53.md`. Borrarlas es decisión del dueño.

---

## Compuertas de T53 (certificación de aislamiento)

Resultado vigente (corrida 6, 2026-11-23 UTC, no certificada por B1) y evidencia: [`CERTIFICACION-T53.md`](CERTIFICACION-T53.md). Antes de encender `AI_ANALYSIS_SANDBOX_ENABLED=true` en cualquier entorno real, un operador debe construir la imagen (sección anterior), desplegar `template.json` y producir un informe de certificación que enlace el `runtime_digest` final con la evidencia real de:

1. **Egreso cero**: intentos de DNS, HTTP/HTTPS, sockets TCP/UDP crudos, enlace al metadata service (`169.254.169.254`), la Runtime API de Lambda (`169.254.100.1:9001`, incluida la interceptación de la invocación siguiente) y conexiones hacia la VPC de producción fallan con bloqueo total.
2. **Sistema de archivos, `/proc` y secretos**: intento de escritura fuera de `/tmp` falla (`Read-only file system`); symlink en `/tmp/result.json` rechazado (`O_NOFOLLOW`); entorno del hijo sin `AWS_*` ni credenciales; lectura de `/proc/<ppid>/environ`, `/proc/<ppid>/mem`, `process_vm_readv` y `ptrace` sobre el padre fallan (padre no-dumpable por el intérprete solo-ejecución); ningún secreto presente en proceso ni en logs.
3. **Límites de recursos**: bomba de memoria (`ANALYSIS_MEMORY`), ciclo infinito de CPU (`ANALYSIS_TIMEOUT`), fork bomb (`RLIMIT_NPROC`), inundación de stdout/stderr y archivo grande en `/tmp` (`RLIMIT_FSIZE`) terminan dentro del presupuesto sin dejar procesos huérfanos, incluido un daemon que hace doble `fork` + `setsid` para escapar del grupo de procesos.
4. **Aislamiento multi-tenant (100 ejecuciones alternando 3 tiendas)**: ejecución de 100 invocaciones consecutivas alternando datos marcados de 3 tiendas distintas (reutilizando el mismo entorno caliente de Lambda) con verificación de cero residuos en `/tmp`, memoria, variables globales o respuestas cruzadas.
5. **Revisión de política IAM**: verificación en AWS de que el rol de ejecución de la Lambda solo tiene permisos ENI y el rol del backend solo tiene `lambda:InvokeFunction` sobre ese único ARN.
6. **Firma y fijación de digest**: registrar el `runtime_digest` verificado en el informe firmado (commit y tag firmados con SSH; ver «Evidencia auditable y firma» en la certificación) y fijar `AI_ANALYSIS_CERTIFIED_DIGEST` a ese valor exacto. Cualquier cambio de imagen, dependencias o plantilla invalida la certificación y exige re-certificar.
