# Fase E — sandbox opcional de lectura

## Operación estándar de autonomía

A, D0, B, D1, C, D2, H, G, E y F son comportamiento estándar de Vex/Vexi,
sin interruptores de entorno ni rutas OFF. Para detenerlos se usa el apagado
general existente de Vex/Vexi, conservando objetivos, evidencias y propuestas.
No cambian autorización, consentimiento individual, proveedor ni cuotas.

El sandbox sólo está disponible con runtime Deno aislado/supervisor/configuración
reales y `AI_SANDBOX_SOURCE_KEY` válida; si faltan, informa disponibilidad ausente
y el agente continúa con herramientas normales. Nunca ejecuta código en el host API.
La minería de recetas está activa; publicar requiere revisión firmada con
`AI_RECIPE_REVIEW_KEY`; sin llave no publica y no interrumpe el chat.
El catálogo se sincroniza automáticamente al bootstrap mediante el job idempotente
existente. Sin app de embeddings, presupuesto o vectores, conserva búsqueda léxica
autorizada; no exige mapear configuración adicional en Secrets Manager.

La verificación offline histórica de este documento no certifica despliegue,
PostgreSQL real, proveedor ni QA acústica. Estos gates se reportan pendientes,
no se convierten en controles de activación por entorno.


Implementación offline, **OFF / no desplegada / no certificada para ejecutar
código adversarial**. No se ha provisionado infraestructura, instalado Deno,
construido imagen ni contratado servicio. Fase F no forma parte del entregable.

## Circuito compartido

El broker fija principal/objetivo/nonce/manifiesto/working set. Por llamada:

1. Frame exacto y secuencia, lease/deadline/budget vigente.
2. Manifiesto ∩ working set inicial ∩ catálogo actual, permisos actuales ∩
   snapshot HTTP/worker ∩ snapshot D1, restricciones actuales de agente/plan.
3. `runIsolated` sin fallback global ni roles; registry y servicios existentes.
4. Intento auditable antes del dispatch; proyección de JSON permitido, referencia
   D1 persistida antes de responder al guest y cuota existente por lectura exitosa.
5. Revalidación de autoridad tras lectura y antes del resultado final. Teardown
   del supervisor confirmado mediante exit0 antes de publicar cálculo.

El wrapper no cobra otra unidad de tool. Presupuesto D1 sí conserva sus llamadas
internas y wrapper. La fuente no entra a SSE/transcript: hash LF/NFC y metadata;
auditoría guarda AES-256-GCM+AAD, nunca texto fuente/args/resultados en logs.
No bearer en guest, colas, auditoría ni infraestructura de runner. Background sin
capability/scope suficiente queda indisponible; no se persisten credenciales.

## Política inicial deliberadamente estrecha

- Sólo `list_products` v1: schema/permiso fijados, args estrictos sin coerción ni
  claves tenant/context/auth, hasta25 productos por página, variantes omitidas.
- Semántica leída: `products.tools.ts` → `ProductsService.findAll` con scope ALS.
  Lecturas inventario org-wide quedan fuera, igual que writes/UI/endpoints
  genéricos/planes/scratch/discovery y recursión. `readOnly` no basta.
- Rol `kitchen` original o actual queda denegado: quitar roles permitiría saltar
  la ocultación de dinero del servicio. No se cambia esa regla del negocio.
- Sin `parallelSafe` auditado se ejecuta **serial**. Última página no prueba
  conjunto completo; variantes omitidas tampoco. El resultado calculado nunca
  es postcondición ni concede `completed_verified` o promoción a receta.
- `findAll` todavía hidrata variantes internamente: cap de proyección no limita
  memoria/SQL del host. Validar capacidad/consulta en QA antes de cualquier ON.
- JS async import-free; TS es sólo sintaxis JS válida/JSDoc. No compilador TS ni
  regex para borrar tipos. SyntaxError se rechaza sin stack ni reintento.
- Dinero: usar unidades enteras/escala decimal con datos que conserven precisión;
  precios del catálogo ya redondeados no reconstruyen el Decimal original. Para
  contabilidad exacta preferir tool/reporte decimal, no floats ni sandbox.

## Runner y configuración

Contrato operativo en [infra/agent-sandbox/README.md](../infra/agent-sandbox/README.md).
Supervisor Python estándar Linux x86_64 y pipes privados, Docker local/runsc,
seccomp default-deny revisado, cgroups v2 verificables. Guest sin red/fs/env/run/
FFI/sys/imports/secretos/mounts; código cargado como dato. Deno no limita recursos
por sí solo ni valida autoridad Vendix. [Modelo Deno](https://docs.deno.com/runtime/fundamentals/security/),
[modelo gVisor](https://gvisor.dev/docs/architecture_guide/security/).

Requiere sesión durable vigente y supervisor/config con
rutas absolutas; `AI_SANDBOX_POLICY_DIGEST`, `AI_SANDBOX_RUNTIME_DIGEST` por SHA256;
verificación real de aislamiento por el supervisor; `AI_SANDBOX_SOURCE_KEY` base64 canónico32bytes.
El config root-owned exige reporte independiente ligado a imagen final, política,
seccomp, runsc y supervisor reales. Ninguno se configuró aquí. Base de imagen sí
fijada por manifest oficial; no se inventó digest de imagen final ni perfil QA.

Máximos256MiB/1CPU/2sCPU/30s wall/20calls/3concurrent/10pages/5000rows/2MiB
entrada/64KiB salida/32KiB fuente. Piloto serial; wall guest≤aprox18s porque12s se
reservan para teardown dentro del lease30s. Supervisor limita también stdout
TOTAL y usa `cgroup.kill`, Docker kill/rm, cgroup vacío y cápsula removida como
acuse. Cliente **no mata al watchdog** durante limpieza. Timeout/cancelación
fencea RPCs tardías; ningún resultado tardío revive sesión. Monitoreo/reaper
externo ante caída de host/supervisor es gate obligatorio, no desplegado.

## Persistencia / rollback

Migración nueva `20261018120000_ai_agent_script_runs` y modelo Prisma:
CREATE TABLE/INDEX IF NOT EXISTS únicamente, sin histórico/backfill/cascades.
Repository raw SQL obliga org/store/user/objetivo. Getter sólo Global para sink
de sistema; no delegates Store/Org que no garantizan owner ACL. AES-GCM AAD liga
principal/ID/objetivo/hash/digests; `get` excluye todos los campos de cifrado.

Admisión transaccional advisory-lock con ReadCommitted, máximo1 slot/tienda y
`AI_SANDBOX_MAX_RUNNERS` default2 (máximo32). Cooldown no renovable30s aunque
finalice, para no liberar cupo antes del kill. Expiry7d impide lecturas de fuente/
metadata; eliminación física y rotación de clave requieren operador aprobado.
Máximo2runs por objetivo/owner: fuente nueva, turno o cooldown no reinician el
contador. Así cabe como máximo una reparación, nunca relanzamientos OOM sin fin.
No se aplicó migración alguna ni se accedió a DB real. Prisma generate sí se
ejecutó sobre el symlink compartido permitido, sin instalar paquetes.

Rollback: E OFF y reiniciar sólo durante despliegue aprobado para retirar tool
del catálogo. No borrar tabla ni reactivar leases; conservar auditoría. Con flags
OFF no hay tool nueva y se conserva el circuito previo. Migración B anterior
CHECK valida filas existentes: **requiere ventana de mantenimiento**, no aplicada.

## Verificación y gates

Specs focales del broker/client/policy/audit y seam real loop+registry+policy+D1
con transporte proveedor/runner/dominio/SQL sintéticos; Python sólo mocks.
No ejecutan guest ni prueban el kernel/gVisor, Docker real, SQL locks reales o
ASR/UI. El replay A presupuesto0 no hace llamadas: métricas reales permanecen
NULL, nunca ceros exitosos de seguridad/completion.

Intento de typecheck semántico del grafo de9 archivos producción agotó heap
1536MiB (exit134); no se amplió ni repitió. Syntax-only no equivale a tipos/DI.
Chequeo semántico realmente focal de cliente/protocolo (2archivos, heap768MiB)
PASS; no certifica broker, integración, servicios ni DI globales.
CI/build/bootstrap de esta rama es gate explícito. Docker dev monta checkout
principal, **no esta rama**; sus logs no certifican E. D1 frontend/NgRx sigue
pendiente de entorno anterior; E no toca frontend ni instala dependencias.

Antes de habilitar: revisión especializada independiente; Linux QA adversarial
imports remoto/local/cache/npm/JSR, fetch/DNS/metadata/loopback, fs/env/run/FFI,
workers/infinite loop/memory/stdout/PIDs, cancel/in-flight/daemon failure/orphans;
100 ejecuciones alternadas entre3tenants; oráculos suma/join/paginación y
decimales; DB real de admisión/ACL/crypto/retención. Registrar0escapes/egress/
writes/IDOR/secretos observados, sin prometer seguridad universal.

Rafael debe autorizar capacidad y gasto/QA para cohortes elegibles: ≥30% menos
provider rounds y ≥20% menos costo total/latencia sin perjudicar tareas simples.
Baseline/canary/proveedor/PTC/E2B y mediciones reales están diferidos, no son
bloqueo para cerrar implementación offline. No se cambia modelo/config/proveedor.
