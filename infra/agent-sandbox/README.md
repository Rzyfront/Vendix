# Sandbox E: adaptador Linux/gVisor, sólo lectura

**Estado: implementación OFF y no desplegada. No certifica aislamiento.** No se
instaló Deno, construyó imagen, provisionó Linux ni ejecutó código no confiable en
esta Mac. El feature permanece no disponible sin configuración del operador y
revisión independiente. No hay fallback a Deno local, Node `vm`, shell ni `eval`
en Nest. No modificar Docker compose/producción como parte de este entregable.

## Fronteras de confianza

```text
Nest: autoridad vigente + admisión/lease + auditoría tenant-scoped
   │ stdin/stdout privados, proceso supervisor de confianza
   ▼
supervisor.py (Python stdlib, host Linux dedicado, sin datos de producto/DB/Redis)
   │ docker socket LOCAL del host (NUNCA dentro del guest)
   ▼
cápsula efímera runsc/gVisor + cgroup v2 + seccomp + UID65532 + rootfs RO
   └── Deno /runtime/runner.ts, source recibida como DATO por stdin
          └── tools.<nombre>(args) → RPC host → MISMO registry/permisos
```

Todo el guest es adversarial, incluidos SDK, stdout y resultados. Ningún frame
le confiere autoridad. El supervisor nunca acepta un `ready` del guest. No hay
HTTP, listener, puerto de callbacks, mount de repo, socket, secreto ni bearer en
la cápsula. El host debe volver a validar tool/schema/permiso/suscripción/scope
vigentes por llamada mediante contexto explícito aislado. `readOnly` solo no es
auditoría semántica. El host excluye UI, writes, scratch/planes, descubrimiento
administrativo, `call_endpoint` genérico y sandbox recursivo.

Los permisos Deno **no** son el aislamiento OS. Source entra como cuerpo de
`AsyncFunction` **dentro de la cápsula ya validada**, no como módulo inicial ni
archivo. Esa función no es una frontera de seguridad JS. Ocultar globals es
hardening/UX solamente: constructor/eval/Worker no otorgan permisos extra, pero
sus intentos de escape/DoS deben probarse en Linux. CLI deniega read (incluidos
archivos runtime), write, net, env, run, FFI, sys e imports; no npm/remoto, caché
vacía y lock congelado. `DENO_PERMISSION_BROKER_PATH` está expresamente ausente:
un broker Deno externo ignora los flags de permisos.

## JS/TS limitado y contrato de source

Se admite cuerpo de función async: `await`, JSON, arrays, objetos y cálculo en
memoria. No imports/deps/módulos/paquetes/instaladores ni cargadores del usuario.
`language: "typescript"` acepta **sólo el subset de TypeScript que ya es JavaScript
válido y JSDoc**. No admite annotations `: number`, interfaces, enums, decorators,
JSX, `as`, imports type ni transpila/borra tipos por regex. SyntaxError se vuelve
fallo genérico sin stack/fuente. No afirmar compatibilidad con TS completo.

Ejemplo de source sintética (recibe recibos, no sólo `data`):

```javascript
/** @type {number} */ const factor = 6;
const receipt = await tools.list_products({ page: 1, limit: 10 });
return { factor: factor * 7, receipt };
```

No usar floats binarios para dinero: agregar con unidades enteras acotadas o
tools/reportes que preserven Decimal. Este runtime sin dependencias no incluye
una biblioteca decimal. Fuentes/args/resultados pueden contener PII; auditoría
host cifrada/ACL/retención por tenant, no logs de consola ni stderr de source.
No hay fuente/args/resultados en logs Docker (`--log-driver=none`).

## Protocolo NDJSON v1

Un proceso/cápsula por ejecución. UTF-8 estricto, un objeto por línea. Host debe
iniciar con **exactamente** estas claves:

```text
{type:"start",execution_id,nonce,source,language:"javascript"|"typescript",
 tools:string[],limits:{wall_ms,cpu_ms,memory_mb,calls,concurrency,pages,rows,
 input_bytes,output_bytes,source_bytes},policy_digest,runtime_digest}
```

- IDs: `[A-Za-z0-9_-]{1,128}`, nonce aleatorio32–128chars. Tools canónicas
  `[a-z][a-z0-9_]{0,99}`, únicas, hasta20. Nonce no es autoridad de producto.
- Source normalizada Unicode NFC y CRLF/CR→LF; host audita el mismo hash.
- `policy_digest`: `sha256:` +64hex del **archivo completo** security-policy.json
  (bytes, incluido newline), no de su JSON reserializado.
- `runtime_digest`: manifest inmutable de la **imagen guest final**, no el digest
  base, image config ID ni un tag mutable.
- Después de Docker inspect, runsc root-owned hash y cgroup reales verificados,
  supervisor emite `{type:"ready",execution_id,nonce,policy_digest,runtime_digest,
  isolation:"gvisor"}`. Sólo entonces envía source al guest.
- Guest→host: `{type:"call",execution_id,nonce,seq,tool,args}` con `seq` empezando1,
  creciente sin huecos, args objeto, tool en manifest. Host trata también una
  llamada perfectamente falsificada como no confiable.
- Host→guest: `{type:"reply",execution_id,nonce,seq,result:<receipt>}` **o**
  `{type:"reply",execution_id,nonce,seq,error:"SANDBOX_DENIED"}`. No ambas claves,
  extras, replay ni otra ejecución. Receipt ya filtrado por host.
- Guest→host final: `{type:"result",execution_id,nonce,value:<JSON>}`. Sin RPCs
  pendientes, bytes restantes, NaN/Infinity ni claves extras. Valor candidato,
  no postcondición/éxito de dominio. El guest queda vivo esperando el kill del
  supervisor para evitar carrera con desaparición del cgroup.
- Host cancel: `{type:"cancel",execution_id,nonce}`; EOF/SIGTERM también cancela.
- Supervisor falla con exit1 y stderr fijo `SANDBOX_UNAVAILABLE_OR_DENIED`, sin
  source, args, payload/stack. No emite fake result/error/ready. En éxito emite
  result, **limpia la cápsula y sólo después sale0**. Cliente debe esperar `close`
  satisfactorio antes de aceptar el resultado, no sólo el frame.

Supervisor y host validan frames/secuencia/size/concurrencia independientemente
del SDK. Rechazan incluso claves JSON duplicadas, UTF-8 inválido y números
no finitos. Respuestas tardías no reviven lease/cápsula. Source no recibe
principal, store/org, bearer, contexto request, DB/Prisma ni filesystem.

## Presupuestos y kill

Caps máximos:256MiB hard sin swap,1vCPU cuota,2s CPU acumulada,30s wall desde
inicio de cápsula incluidas RPC,20calls/3concurrentes,10páginas/5000filas,
2MiB entrada,64KiB salida,32KiB source. Menor presupuesto host/objetivo gana;
ningún límite se amplía automáticamente. El cliente puede reservar12s del lease
de30s para teardown y ofrecer wall≤18s: restricción deliberada, no ampliación.

El supervisor cuenta **todo stdout guest** (calls+result+newlines) contra
`output_bytes` y todos replies/control host contra `input_bytes`; es más
estricto que limitar sólo el valor final. Start/ready no cuentan como datos RPC;
start tiene cap separado128KiB. El host además lleva contadores semánticos de
páginas/filas, cuotas por herramienta y bytes de datos. Supervisor no adivina
filas de recibos arbitrarios ni sustituye la autoridad semántica del broker.

- Verifica `/proc/<PID>/cgroup`, cgroup v2 descendiente no raíz, `memory.max`,
  `memory.swap.max=0`, `pids.max=64`, `cpu.max`1core y `cgroup.kill` escribible.
- Watchdog externo al guest muestrea cada20ms CPU **acumulada del cgroup**,
  memory.events OOM y pids.events; también wall/EOF/frames/bytes/stderr.
  Polling tiene granularidad/scheduling; no prometer exactitud de milisegundos.
  Cuota CPU/mem/PIDs kernel y RLIMIT_CPU son defensas hard adicionales.
- En todo terminal: marca dead/fence, **`cgroup.kill=1` primero**, luego Docker
  kill y `rm --force`, y termina grupo del CLI attach. No mata sólo PID Deno.
  Kill cgroup no depende del daemon Docker. Fallos de limpieza no amplían lease;
  admisión host conserva cooldown hasta vencimiento y requiere monitor/reaper.
  Cleanup tiene deadline compartido8s y sólo confirma éxito con kill kernel
  solicitado, cgroup observado vacío/desaparecido, `docker ps` exitoso sin la
  cápsula y attach terminado. Daemon caído/inspect fallido no prueban ausencia.
  Sin esa confirmación el supervisor sale1 incluso si emitió result candidato.
- **No enviar SIGKILL al supervisor durante cleanup.** Dar≥10s de gracia y
  esperar close; el supervisor destruye en finally. SIGKILL del proceso API
  cierra stdin y el supervisor (sesión propia) sigue vivo para limpiar. Si se
  mata también supervisor/host/kernel, sólo monitor/reaper externo puede evitar
  huérfanos: ese gate operativo no está desplegado aquí.

## Despliegue: adaptador implementado, infraestructura pendiente

Sólo Linux **x86_64** dedicado, Python3 estándar, Docker CLI `/usr/bin/docker`
con daemon local `unix:///var/run/docker.sock`, runsc registrado con **ruta
absoluta**, cgroup v2/kernel con cgroup.kill y delegación de kill. No Docker
Desktop/macOS/Windows, runtime runc, root cgroup, daemon remoto, rootless sin
límites verificables ni missing Deno se convierten en ejecución local.

Operador debe revisar seguridad/capacidad/costo, construir **allí** con este
directorio como contexto, fijar/publicar/aprovisionar imagen final por manifest
digest después de aprobación y generar reporte independiente. Supervisor sólo
acepta imagen ya presente (`--pull=never`); no instala/descarga nada.

La base oficial fue consultada **sólo por lectura de registry** el2026-10-17:

| Deno distroless2.9.7 | Digest observado |
|---|---|
| OCI index | `sha256:16583ef81ce73d6fdf806174fbda68bf4c57e914659ffe6b1c2b600ac2327962` |
| Linux/amd64 manifest (Dockerfile) | `sha256:7f06129434994563daa79855c92b1d20f03a2307c3f17dae6359a48578f19e58` |

Pin no equivale a ausencia de vulnerabilidades; revisar CVEs/procedencia y
flags exactos de esta versión antes del gate. No se inventa digest final.

Instalar supervisor/policy/config/perfil seccomp/reporte fuera del repo, con
archivos **y todos sus padres root-owned**, sin symlinks ni group/world-write.
Perfil seccomp revisado debe tener defaultAction `SCMP_ACT_ERRNO` y allowlist
de syscalls suficiente para esta versión; no se distribuye un perfil ficticio
"certificado". Inspección compara JSON seccomp serializado por Docker CLI, no
sólo nombre de archivo. Cambiar cualquier digest exige nuevo reporte/revisión.

Invocación exacta del cliente, sin shell y env sólo PATH fijo:

```text
/ruta/absoluta/supervisor.py --config /etc/vendix-sandbox/config.json
```

Config JSON con **exactamente** estas claves (valores a producir por operador;
esta plantilla es deliberadamente inválida y no habilita nada):

```text
{
 "image":"REGISTRY/guest@sha256:FINAL_MANIFEST_HEX64",
 "runtime_digest":"sha256:FINAL_MANIFEST_HEX64",
 "policy_path":"/etc/vendix-sandbox/security-policy.json",
 "policy_digest":"sha256:ACTUAL_POLICY_FILE_HEX64",
 "seccomp_path":"/etc/vendix-sandbox/seccomp.json",
 "seccomp_digest":"sha256:ACTUAL_SECCOMP_FILE_HEX64",
 "runsc_path":"/usr/local/bin/runsc",
 "runsc_digest":"sha256:ACTUAL_RUNSC_BINARY_HEX64",
 "review_path":"/etc/vendix-sandbox/isolation-review.json",
 "review_digest":"sha256:ACTUAL_REVIEW_FILE_HEX64"
}
```

Reporte root-owned, fijado por review_digest, debe declarar:
`isolation_validated:true`, `independent_review_approved:true`, `environment_id`
no vacío, `runtime_digest`, `policy_digest`, `seccomp_digest`, `runsc_digest` y
`supervisor_digest` exactos. El reporte debe conservar evidencia real, versión de
kernel/Docker/runsc/seccomp, fecha/revisor/amenazas y casos. Un JSON con true no
prueba aislamiento: requiere revisión humana independiente y evidencia Linux.
Ningún reporte/config aprobado está incluido en el repo por esa razón.

No hace falta Deno en el API host. El ejecutable sólo existe dentro de la imagen
guest; si falta el runtime/image/config aprobado, el adaptador falla cerrado.
No heredar entorno host: ni Docker contexts/DOCKER_HOST, proxies, Deno flags,
permission broker, PYTHONPATH o credenciales. La imagen permite sólo lista exacta
de constantes no secretas, ver GUEST_ENV. Cambiar imagen/env requiere revisión.

## Verificación y gates pendientes

Contrato offline serial exacto, stdlib con subprocess/Docker **mockeados**:

```text
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest infra/agent-sandbox/test_supervisor.py
```

No unittest discover, suites grandes, Docker build ni `deno run` en esta Mac.
Tests offline no ejecutan scripts adversariales ni prueban aislamiento real.

**En Linux QA separado, antes de habilitar:** revisión independiente y ataques
a fetch/DNS/metadata/loopback; env/fs/runtime files; subprocess/FFI/sys; imports
locales/remotos/cacheados/npm/JSR/node/Blob/Worker y cualquier loader; permisos
escalados por Worker/eval/Function; infinite loop/memory bomb/worker/PID/stdout/
stderr flood; CPU agregada con workers; late RPC/cancel/EOF/API SIGKILL; Docker
daemon detenido durante kill; cgroup.kill y reaper/monitor externos;100capsules
alternadas de3tenants sin estado/PII residual. Cero escapes/egress/writes/IDOR,
sin secretos en guest/log. Verificar memoria≤256MiB, CPU/clock/teardown y ausencia
de huérfanos/reutilización. Probar script malformado/dobleframe/inyección sin
privilegios, revocación de permisos/plan y admisión global/por tienda.

Comparar suma/join/paginación con oráculos deterministas (dinero Decimal/entero),
tools agregadas y beneficio incremental de fan-out. Medir rounds/costo total/
latencia/task completion reales sólo con autorización de QA/gasto. Una pregunta
simple debe seguir en tool agregada/`vex_block_transform`. Mocks verdes no
habilitan flag, no certifican aislamiento ni cumplimiento de los gates del plan.

## Fuentes primarias consultadas

- [Modelo de seguridad Deno](https://docs.deno.com/runtime/fundamentals/security/)
  (grafo inicial, permisos, eval/Worker, capas OS y permission broker).
- [CLI Deno2.9.7 fijado](https://github.com/denoland/deno/blob/v2.9.7/cli/args/flags.rs)
  y [Dockerfile oficial distroless](https://github.com/denoland/deno_docker/blob/main/distroless.dockerfile).
- [Docker/gVisor](https://gvisor.dev/docs/user_guide/quick_start/docker/) y
  [modelo de amenazas](https://gvisor.dev/docs/architecture_guide/security/).
- [CLI Docker: serialización perfil seccomp](https://github.com/docker/cli/blob/master/cli/command/container/opts.go).

## Key Learnings:

1. El guest nunca es autoridad; ready pertenece sólo al supervisor tras inspección real.
2. Deno permission flags no limitan CPU/RAM ni sustituyen gVisor/cgroups y revisión Linux.
3. Kill cgroup precede limpieza Docker; un result no es éxito antes del close y verificación host.
4. TS se limita a JS válido/JSDoc; cargar source como módulo inicial o borrar tipos por regex debilita el contrato.
