# Remediación Dependabot — WEB + BACKEND

Fecha: 2026-10-09 · Responsable/aprobador: Rafael · Rama: `fix/security-deps`.
Baseline: `7c095ce66ce551c7cd7a0f5c62fc87b11e223ad6` (`origin/develop` al inicio).
Plan aprobado: `/Users/rzy/.openclaw/tmp/vendix-vulns/plan.md`, decisiones 1, 2, 3, 5 y 6,
con las restricciones de ejecución comunicadas por Rafael.

## Alcance y límites

- Fases ejecutadas: 1, 2, 3, 4 y 6. **Fase 5 omitida por completo.**
- Ningún archivo de `apps/mobile/**` modificado. Ningún override nuevo sobre Expo, Metro,
  React Native, navegación, Expo Router o query-string. Overrides previos conservados.
- `TRUST_PROXY_HOPS`, el predicado de confianza, Nest, Angular, Prisma y DIAN no cambian.
- Sin `node_modules`, instalaciones completas, suites, builds, Docker, push ni PR locales.
  El nuevo workflow es WEB/BACKEND; `.github/workflows/ci.yml` permanece byte-a-byte intacto,
  incluido `backend-test: if: false`. Sus jobs existentes (incluidos mobile) no se alteran.
- “Corregida” en este informe significa **versión remediada en el lock**, no runtime probado,
  cierre de alerta confirmado ni aprobación de release. El recuento original de 40 alertas
  pertenece al plan general con mobile: **no se afirma haber cerrado las 31 previstas**.
  No se recibieron IDs individuales de alertas para conciliar cierres.

## Inventario de los cuatro locks

R = raíz (todos los workspaces), B = backend independiente, F = frontend independiente,
M = mobile independiente **solo leído**. `—` = paquete ausente. Las filas muestran todas
las versiones distintas, incluyendo copias anidadas.

| Alerta/paquete | Estado | R | B | F | M |
| --- | --- | --- | --- | --- | --- |
| `proxy-addr` (critical ×3) | Corregida | 2.0.8 | 2.0.8 | 2.0.8 | — |
| `@modelcontextprotocol/sdk` (high ×2) | Corregida | 1.31.0 | — | 1.31.0 | — |
| `source-map-js` (high ×3) | Corregida F; **pendiente web R**; fuera de alcance mobile | 1.2.1 | — | 1.2.2 | 1.2.1 |
| `compression` (high ×2) | **Fuera de alcance: app móvil inactiva** | 1.8.1 | — | — | 1.8.1 |
| `postcss` (high ×4 + medium ×4) | Web ya corregida; copias vulnerables **fuera de alcance: app móvil inactiva** | 8.4.49, 8.5.28 | — | 8.5.28 | 8.4.49 |
| `js-yaml` (medium ×2, Swagger) | Corregida bajo Swagger; versiones 3/4 no pertenecen a esta alerta YAML5 | 3.15.2, 4.3.2, **5.4.1** | 4.3.2, **5.4.1** | — | 3.15.2, 4.3.2 |
| `postcss-selector-parser` (medium ×2) | Corregida | 7.1.6 | — | 7.1.6 | — |
| `image-size` (high ×4) | **Fuera de alcance: app móvil inactiva** | 1.2.1 | — | — | 1.2.1 |
| `decode-uri-component` (medium ×2) | **Fuera de alcance: app móvil inactiva** | 0.2.2 | — | — | 0.2.2 |
| `sprintf-js` (medium ×3) | Eliminada B; **pendiente backend R**; fuera de alcance mobile | 1.0.3 | — | — | 1.0.3 |
| `braces` (high ×3) | Aceptada temporalmente | 3.0.3 | 3.0.3 | 3.0.3 | 3.0.3 |
| `http-cache-semantics` (high ×3) | Aceptada temporalmente | 4.2.0 | 4.2.0 | 4.2.0 | — |
| `node-forge` (high ×3) | Aceptada temporalmente | 1.4.0 | 1.4.0 | — | 1.4.0 |

Las copias PostCSS/source-map-js/sprintf-js que solo cuelgan de Expo/RN quedan
**fuera de alcance: app móvil inactiva**. Una misma copia hoisted puede ser alcanzable
por backend/web y mobile: su uso backend/web se registra como **pendiente**, no se
oculta calificándolo únicamente como mobile.

## Cambios por fase

1. Express → `proxy-addr@2.0.8` y Swagger → `js-yaml@5.4.1` en R/B/F según corresponda.
   Express solamente aparece en backend y Angular CLI, no en el grafo mobile actual.
   Spec nuevo de OpenAPI JSON/YAML usa el serializador real y verifica YAML ordinario,
   malformado y tags ejecutables. El spec existente de IP no se modifica.
2. Angular CLI → MCP SDK `1.31.0` en R/F; PostCSS declarado F pasa de `^8.4.35` a
   `^8.5.28` sin cambiar su versión resuelta. Overrides de PostCSS/Sass → source-map-js
   `1.2.2` **solo en el manifest independiente F**, no en raíz. Fixtures de CSS/mapas/MCP.
3. Tailwind3, postcss-nested6 y typography → selector parser `7.1.6` en R/F;
   no queda parser6. Fixtures complejos y proceso hijo adversarial con timeout.
4. Istanbul → `js-yaml@4.3.2` **solo en el manifest independiente B**; elimina argparse1
   y sprintf-js de B. Script de contratos coverage JSON/YAML, arrays/números y rechazo
   de tags JS, destinado a CI standalone. El override de Swagger se mantiene separado.
6. Inventario, excepciones, política de locks con vencimiento, comprobación del grafo mobile
   y workflow dedicado con baseline/candidate; no modifica la suite desactivada existente.

### Pendientes por aislamiento mobile

- `source-map-js@1.2.1` de R es compartido por web y Expo. Un override limitado al workspace
  frontend también hizo que npm deduplicara `1.2.2` en Expo. **Ese cambio se descartó.**
- El loader Istanbul de R es compartido por Jest backend y React Native. Un override limitado
  al workspace backend también llevó el loader de RN a YAML4. **Ese cambio se descartó.**
  Por ello R conserva YAML3/argparse1/sprintf-js. El lock B independiente sí elimina la cadena.
- No se fijaron versiones vulnerables en mobile mediante nuevos overrides para resolver
  estos conflictos. No se instalaron paquetes ni se introdujeron parches improvisados.
- Rafael debe decidir en otro alcance cómo aislar físicamente estas cadenas compartidas,
  o autorizar una remediación mobile. Los dos pendientes **no** son excepciones nuevas aprobadas
  hasta noviembre: la aceptación explícita es únicamente para los tres paquetes siguientes.

## Excepciones aprobadas — no son parches

Propietario: **Rafael**. Nueve alertas high según el inventario aprobado (tres por paquete).
Vigencia inclusive hasta **2026-11-08, America/Bogota**. El gate falla a partir de 2026-11-09.
Revisión semanal: 2026-10-16, 10-23, 10-30 y 11-06. Reabrir inmediatamente si aparece un
parche o cambia la exposición. La clasificación aprobada deriva del plan; no se presenta
como una nueva auditoría runtime efectuada en esta sesión.

| Paquete / advisory | Exposición identificada | Control exigido / condición de reapertura |
| --- | --- | --- |
| `node-forge@1.4.0` · [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Backend DIAN: parsing PKCS#12, certificados, PEM/DER y firma; no se identificó la verificación RSA vulnerable en esos caminos | Certificados/llaves confiables, no cambiar custodia/firma. Reevaluar ante nuevos usos de verificación o certificados no confiables. El tooling Expo no se ejecutó ni modificó: sus controles requieren revisión cuando mobile vuelva a activarse. |
| `braces@3.0.3` · [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Tooling micromatch/chokidar/Karma; también presente en tooling B | Globs controlados por configuración; no aceptar patrones arbitrarios de clientes ni exponer watchers a redes no confiables. |
| `http-cache-semantics@4.2.0` · [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) | Descargas/caché de tooling SWC y Angular CLI; no se identificó como caché multiusuario de Vendix | Aislar cachés autenticadas por cuenta/job; no reutilizarlas como caché HTTP multiusuario. El workflow nuevo no comparte cachés npm entre jobs. |

No se efectuó ningún dismissal en GitHub. Confirmar por ID tras incorporar los cambios
al ref analizado por Dependabot; aceptar solo estas nueve alertas con autorización/comentario.

## Verificación local realizada

- Árbol limpio y rama correcta al inicio; `git fetch origin` y divergencia `0 0` respecto
  de `origin/develop`. Node `24.21.0`, npm `11.19.0`.
- Versiones objetivo e integridades consultadas en el registro npm. Locks actualizados
  exclusivamente con `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`;
  presupuesto `NODE_OPTIONS=--max-old-space-size=768` y ejecución secuencial.
- Locks independientes con copia del manifest y **lock previo** en staging temporal
  `.security-deps-work/{backend,frontend}`. Como no se permite escribir en otras carpetas,
  se aisló mediante **`npm --prefix <ruta> … --workspaces=false`** dentro del worktree,
  en lugar del `/tmp` externo del plan. Ningún node_modules generado. Staging eliminado al terminar.
- npm 11 puede conservar nodos inválidos al cambiar un override en un workspace o staging.
  Se resolvieron explícitamente las **versiones existentes de los padres** con el mismo
  `--package-lock-only`, restaurando después los rangos originales del manifest y regenerando
  metadata. No se editaron nodos ni integridades de los locks manualmente. No `audit fix` ni upgrades
  generales. Cada versión final se comprobó leyendo locks y con `npm ls --package-lock-only`.
- `node scripts/security-deps-check.cjs --baseline 7c095ce66`: PASS de política de locks
  con pendientes/exclusiones expresos. Compara recursivamente dependencias, optional y peers
  del workspace mobile y la dependencia raíz Skia (versiones, integridades, URLs y aristas).
  El grafo mobile quedó semánticamente idéntico. Mobile y `ci.yml` sin diff; overrides previos preservados.
- `node --check` de scripts `.cjs`, `bash -n` del helper CI y parseo estático del workflow;
  `git diff --check`. Sondas negativas ligeras en memoria comprobaron que el checker rechaza
  una versión incorrecta y detecta un cambio compartido con mobile, sin editar locks. Sondas con
  reportes Jest sintéticos confirmaron rechazo de shard ausente y fallo nuevo/cambiado; fallos
  iguales al baseline se enumeran explícitamente.
  **No ejecución de specs ni suites**: este worktree no tiene dependencias
  instaladas y está prohibido instalarlas. Tampoco builds, servidores, Docker ni navegador.

### Hallazgos de sincronización/instalación independientes

- Los locks B/F previos aún incluían `@types/xlsx`, ausente en sus manifests: npm retiró esa
  entrada. El lock F no incluía `heic2any@0.0.4`, ya declarado: npm incorporó la entrada.
- La regeneración B inicial con peers legacy retiraba React/ReactDOM/scheduler. En el cierre
  se regeneró B con **`--legacy-peer-deps=false`**, conservando esas dependencias de peers como
  en el baseline, para comprobar el contrato de instalación independiente del Dockerfile.
- SDK `1.31.0` en R también resolvió `@hono/node-server@2.1.4` y
  `express-rate-limit@8.7.1`; son dependencias de esa cadena web/backend. El grafo mobile no cambió.
- **Pendiente preexistente F:** `npm install --package-lock-only --legacy-peer-deps=false`
  falla con ERESOLVE: `@angular/animations@20.3.21` exige `@angular/core@20.3.21`, pero el lock
  resuelve core `20.3.33`. No se alineó Angular fuera del alcance aprobado. F se regeneró con
  la política existente `legacy-peer-deps=true` de raíz. El workflow tiene un job estricto
  independiente sin ese fallback para exponer la deuda de instalación con defaults Docker.
  Un baseline standalone puede además fallar `npm ci` por la desincronización anterior de
  `heic2any`/`@types/xlsx`; ese fallo se reporta como bloqueo, nunca como baseline PASS.

## Qué verificará CI y qué no está demostrado

Workflow nuevo: `.github/workflows/security-deps-validation.yml`. No ejecutado todavía,
porque no se hizo push/PR. Activación: PR a develop o dispatch con SHA explícito de baseline.

- Instalaciones limpias root, limitadas a workspaces B/F sin incluir dependencias raíz,
  y staging independiente de B/F. Scripts de instalación de terceros deshabilitados;
  Prisma generado explícitamente. Node/npm fijados a las versiones usadas para resolver locks.
- Job estricto standalone con defaults peers de Docker, sin `npm install` fallback.
  Se espera que haga visible el conflicto F preexistente; **no prometer CI verde**.
- Verificación de versiones **realmente instaladas desde cada consumidor**, además de locks.
- Suite backend completa, baseline/final, en ocho shards para cada layout (16 jobs con
  concurrencia máxima 4). JSON/logs/exits como artefactos durante 14 días. Comparación agregada
  para que cambios de distribución entre shards no generen diferencias falsas. Nuevas fallas,
  tests omitidos, suites sin aserciones ejecutadas, reportes ausentes, timeout/crash bloquean.
  Fallos preexistentes se enumeran explícitamente (mismo test y fallo normalizado; un fallo
  cambiado también bloquea): el baseline sigue ROJO, no es PASS completo.
- Frontend: suite completa sin watch, ChromeHeadlessNoSandbox, builds reales de navegador
  sin SSR/prerender, fixtures de nesting/responsive/dark/atributos/escapes/:not/typography,
  mapas y carga MCP; CSS exactamente comparado con baseline usando las mismas fixtures.
  Karma no aporta aquí un JSON granular: **cualquier fallo final bloquea**, aunque también
  exista en baseline, para no ocultar regresiones nuevas.
- Compilación backend y contrato coverage YAML standalone. Límites de tiempo explícitos
  y `timeout --kill-after` para impedir procesos colgados. La suite backend puede ser costosa
  aun fragmentada: Rafael debe revisar consumo/tiempos de Actions en la primera corrida.

**Aún requieren ambiente/QA autorizado:** API y worker arrancando con dependencias podadas,
health/login/listado autenticado por curl; firma DIAN con certificados de prueba sin emisión real;
login/formulario/tabla/typography/responsive y consola con Playwright MCP contra el vhost
`https://vendix.com`, con happy/sad/brute-force. OAuth MCP/issuer si ese tooling se usa.
Estas verificaciones no están automatizadas por este workflow y no se afirman ejecutadas.
No pruebas/exportaciones/parches mobile. Release queda condicionado a CI, resolución/revisión
expresa de pendientes y QA anterior; no afirmar “100% funcional”.

## Rollback y referencias

Revertir **el commit de la fase completo** (`git revert <hash>`), con manifests/locks/specs/scripts,
no un lock aislado. Reabre vulnerabilidades; jamás cambiar el predicado/hops para compensarlas.
La fase 6 reconcilia adicionalmente peers del lock B: revertirla devuelve el estado B de fase 4,
por lo que la instalación independiente debe volver a comprobarse. No migraciones DB.

- [Overrides npm (solo gobierna el manifest raíz de cada instalación)](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides)
- [Proxy advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
- [Swagger YAML5 advisory](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm)
- [Selector parser changelog](https://github.com/postcss/postcss-selector-parser/blob/main/CHANGELOG.md)
- [Istanbul loader v1.1.0, consumidor de `yaml.load`](https://github.com/istanbuljs/load-nyc-config/blob/v1.1.0/index.js)

## Key Learnings:

1. Un override limitado a un workspace no garantiza que npm preserve cadenas mobile compartidas por hoisting.
2. El lock raíz y los locks de despliegue independientes necesitan verificaciones distintas, incluyendo la política de peers.
3. Un PASS de política de locks con pendientes no equivale a cero vulnerabilidades, tests PASS ni aprobación de release.
