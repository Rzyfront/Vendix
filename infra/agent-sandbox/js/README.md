# Ejecutor JS de Code Mode sobre AWS Lambda aislada (F10 · T63)

**Estado: implementación lista en código/IaC, APAGADA por defecto y NO desplegada. T69 (certificación de aislamiento sobre la Lambda real) está PENDIENTE.**

Nunca se crea ni despliega infraestructura AWS desde el entorno de desarrollo ni desde esta rama. Esta Lambda ejecuta el JavaScript que escribe el modelo para componer herramientas de **solo lectura** de Vex ("Code Mode", etapa 1). **Nunca ejecuta una herramienta**: las herramientas las ejecuta el backend, con la autoridad de la sesión, entre rondas.

---

## Contrato (`vendix.codemode/v1`)

Fijado en `apps/backend/src/ai-engine/sandbox/interfaces/codemode-protocol.interface.ts` (solo lectura para este directorio). Todo cambio allí debe espejarse aquí y en `handler.test.cjs` (los vectores de hash se comparan contra el archivo TS).

- Petición (claves exactas): `protocol`, `execution_id`, `nonce` (64 hex), `round`, `language: "javascript"`, `source`, `manifest`, `journal`, `clock_ms`, `seed` (64 hex), `limits` (las 15 claves de `CODEMODE_LIMITS`; los valores por encima de los máximos duros se recortan, nunca se confían). Cualquier desviación → `CODEMODE_INPUT`.
- Modelo del script: `source` es el **cuerpo** de una función `async`; su `return` es el resultado. Globales inyectados: `tools` (congelado, una función `async` por nombre del manifiesto), `console` (capturado y acotado), `vex.block(block)` (≤ `limits.blocks`) y los built-ins del lenguaje. No existen `require`, `process`, `fetch`, temporizadores, sistema de archivos ni red. Una herramienta fuera del manifiesto no existe en `tools` y falla dentro de la Lambda.
- Repetición determinista: cada `tools.<nombre>(args)` recibe `seq` 1, 2, 3… en orden de llamada. Acierto en el diario con misma herramienta y mismo `args_hash` (sha256 del JSON canónico) → se resuelve (o se rechaza con `Error` si `ok:false`) con el resultado del diario; discrepancia → `CODEMODE_REPLAY_DIVERGENCE`; ausencia → pendiente. Al vaciarse la cola de trabajos: script terminado → `completed`/`error`; si no, hay llamadas pendientes → `pending` con las `pending_per_round` de menor `seq` (el resto se reemite de forma determinista en la ronda siguiente); si no → `CODEMODE_STALLED`.
- Reloj y azar: `Date` congelado en `clock_ms` (`Date.now()` y `new Date()`), `Math.random` = PRNG sfc32 sembrado con `seed` (misma secuencia en cada ronda). Los `console.log` se repiten en cada ronda (el script corre desde el inicio); el host debe tomar los logs de la última ronda.
- La respuesta **nunca** contiene diario: el host lleva el suyo en el servidor y no lee ninguno que venga de la Lambda.

---

## Arquitectura

```text
NestJS (puente CodeMode) — autoridad vigente, manifiesto, diario, auditoría
   │  RequestResponse JSON (vendix.codemode/v1, nonce 64 hex, TenantId opaco por tienda)
   │  política IAM mínima: backend-invoke-policy.json (solo lambda:InvokeFunction a 1 ARN)
   ▼
AWS Lambda (imagen contenedor Node 22 · Dockerfile + template.json)
   ├── Aislamiento por tenant PER_TENANT: un entorno de ejecución nunca se reutiliza entre tenants
   ├── VPC dedicada con subredes privadas únicamente (sin IGW, sin NAT, sin VPC endpoints)
   ├── Security group sin ingress y sin egress real (regla loopback reemplaza allow-all)
   ├── Rol IAM limitado exclusivamente a gestión de ENI; sin variables de entorno de la plantilla
   ├── Código en LAMBDA_TASK_ROOT de solo lectura; solo /tmp escribible
   └── Por cada ronda (handler.cjs → runner.cjs):
          1. Valida estrictamente la petición (claves exactas, tamaños desde `limits`, diario contiguo).
          2. Limpia /tmp antes y después.
          3. Lanza un proceso hijo NUEVO (`node runner.cjs`) con entorno vacío, en su propio grupo de procesos,
             JSON por stdin/stdout, tiempo de pared (`round_cpu_ms` + 5 s de arranque) y stdout acotado.
          4. El hijo crea un runtime y contexto QuickJS (WASM) nuevos: `setMemoryLimit(memory_mb)`,
             manejador de interrupción por CPU (`round_cpu_ms` → CODEMODE_TIMEOUT), memoria agotada →
             CODEMODE_MEMORY, sintaxis → CODEMODE_SYNTAX.
          5. Mata el grupo (SIGKILL), revalida lo que imprimió el hijo y devuelve solo JSON acotado.
             Mensajes de error sin rutas y ≤ 500 caracteres.
```

Por qué QuickJS/WASM y no Node `vm`: `vm` no es una frontera de seguridad; un intérprete en WASM solo ve lo que el host le inyecta. Dependencia única, justificada por T63 (el plan exige un intérprete WASM): `quickjs-emscripten@0.32.0` (versión exacta, `package-lock.json` versionado, instalación con `--ignore-scripts`). Este directorio **no** es un workspace del monorepo.

---

## Interruptor apagado por defecto

El backend devuelve "no disponible" (y Vex no ofrece `run_code`) salvo que **todas** estas variables estén configuradas:

| Variable | Requisito |
| --- | --- |
| `AI_CODEMODE_SANDBOX_ENABLED` | Exactamente `'true'` |
| `AI_CODEMODE_LAMBDA_FUNCTION_ARN` | ARN concreto de `vendix-agent-codemode` (sin comodines) |
| `AI_CODEMODE_LAMBDA_REGION` | Región AWS válida que coincide con la del ARN |
| `AI_CODEMODE_RUNTIME_DIGEST` | `sha256:<64 hex>` inyectado en la imagen (`CODEMODE_RUNTIME_DIGEST`) |
| `AI_CODEMODE_CERTIFIED_DIGEST` | `sha256:<64 hex>` **idéntico** a `AI_CODEMODE_RUNTIME_DIGEST`, fijado solo tras completar T69 |

Además, la capacidad de plan `vex.code_mode` (apagada en todos los planes) y la suite de ataque entre tiendas en verde.

---

## Pruebas offline (sin AWS ni Docker)

```bash
cd infra/agent-sandbox/js
npm ci --ignore-scripts          # solo quickjs-emscripten
node --test handler.test.cjs template.test.cjs
```

`handler.test.cjs` ejecuta el handler real y el hijo QuickJS real (ligero, `node:test`, sin jest): tres rondas con dos `Promise.all`, herramienta fuera del manifiesto, ausencia de `fetch`/`require`/`process`/archivos, bucle infinito (TIMEOUT), bomba de memoria (MEMORY), divergencia, atasco, 8 pendientes de menor `seq`, `Date`/`Math.random` deterministas, vectores de hash contra el contrato TS, límites espejo, validación estricta, respuesta sin diario y aislamiento entre dos `TenantId` (globales y `/tmp`). `template.test.cjs` fija la forma de aislamiento de `template.json` (PER_TENANT, sin IGW/NAT/endpoints, SG sin ingress, rol solo ENI, concurrencia reservada 5, política de invocación de un solo ARN).

Estas pruebas **no** prueban el aislamiento real de la microVM, la red, el modo PER_TENANT ni la memoria de la Lambda; eso es T69.

---

## Compuertas pendientes de T69 (certificación de aislamiento) — PENDIENTE, NO HECHO

Verificar sobre la función REAL desplegada por un operador, con el digest de la imagen:

- [ ] Propiedad CloudFormation `TenancyConfig.TenantIsolationMode = PER_TENANT`: nombre exacto, disponibilidad en la región de Vendix y límites (no admite concurrencia aprovisionada ni SnapStart, no se cambia tras crear la función). El nombre de la propiedad en `template.json` es el de la documentación de AWS y **no se ha validado contra CloudFormation**. Sin él disponible, T69 no certifica.
- [ ] Egress: sin internet, sin DNS, sin `169.254.169.254` (metadatos) y sin API de AWS, desde el proceso hijo.
- [ ] Sistema de archivos: raíz de solo lectura; `/tmp` limpio entre rondas e invocaciones; nada visible entre tenants.
- [ ] Memoria: bomba de memoria cortada dentro de 512 MB (el tope de QuickJS es 256 MB; confirmar que Node + WASM caben).
- [ ] Tiempo: bucle infinito cortado por CPU y por pared dentro del `Timeout` (35 s ≥ pared del host de 30 s); medir el arranque en frío de WASM por ronda.
- [ ] 100 ejecuciones alternando tres tiendas: ningún dato, global ni archivo cruza de una tienda a otra.
- [ ] Suite T68 (ataque entre tiendas) contra la función desplegada.
- [ ] Fijar la imagen base por digest (`FROM ...nodejs:22@sha256:...`) y registrar el digest en `certification-report.json`; solo entonces fijar `AI_CODEMODE_CERTIFIED_DIGEST`.
- [ ] Opcional: evaluar `--permission` de Node como defensa adicional del proceso hijo (no sustituye al WASM).
