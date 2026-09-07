# PLAN — `how-to-critical-plan` v2.0: del archivo monolítico al bundle fragmentado

## Context

Los planes críticos producidos por `skills/how-to-critical-plan` (v1.1) son efectivos pero insostenibles en tokens: hay 13 planes `CP-*` en el repo que suman 1,58 MB; el mayor (`docs/plans/CP-INVOICE-PROFILE-MIRROR-AIU.md`) pesa 732 KB ≈ 183k tokens y `docs/planes/QUI-727-plan-critico-ejecutado.md` 333 KB ≈ 83k tokens (48% en `Phases and Steps`, 10% en `Contract Inventory`, 10% en `Execution Log` con 785 B/fila; ítems de checklist de 345 B promedio y 1.628 B máximo). La causa raíz es estructural: un solo archivo cumple cinco roles (spec, registros de contratos, tracker de progreso, diario de hallazgos, historial) y toda actor —humano, orquestador, ejecutor de un step, 13 perspectivas por ronda— carga los cinco; además cada ronda de la flota inyecta hallazgos con rationale completo dentro del step, más una línea de cierre, más un `[x]` duplicado, de modo que el archivo crece sin techo por diseño. Resultado: >30% del contexto en modelos de 1M, autocompact en bucle en modelos de 250k, y evidencias en `/tmp` volátil que rompen el handoff prometido. El usuario decidió (2026-09-05): fragmentos con frontmatter YAML + markdown, aplicar solo a planes nuevos (sin migrar los existentes), y presupuestos duros que `cp-lint` hace fallar.

## General Objective

Un plan crítico conserva todo su detalle (12 campos, 13 perspectivas, 3 registros completos, 2 rondas limpias) pero ningún actor necesita cargar más de ~8k tokens de plan para actuar, y el bundle no crece sin techo durante la ejecución.

## Specific Objectives

1. `skills/how-to-critical-plan/SKILL.md` v2.0 pesa ≤ 14 KB (hoy 40 KB) y delega el detalle a `references/*.md` cargados bajo demanda; los 7 `auto_invoke` y la invocación explícita quedan intactos.
2. Existe una estructura de bundle `docs/critical-plans/CP-<slug>/` con hub `PLAN.md` + `adr/`, `registry/`, `steps/`, `findings/`, `log/`, `inventory/`, `evidence/`, definida por 11 plantillas con frontmatter YAML plano.
3. `assets/cp-new.sh <slug>` crea un bundle válido desde las plantillas en un solo comando.
4. `assets/cp-lint.sh <bundle>` devuelve exit 1 ante: sección o campo obligatorio ausente, presupuesto excedido (hub 8k tokens · step 2,5k · ADR 1,5k · finding 800 · fila de registro 400 chars · fila de log 300 chars · ítem de checklist 200 chars), o referencia cruzada colgante (`F-*`, `FB-*`, `DB-*`, `ERR-*`, `ADR-*` citado sin archivo/fila).
5. `assets/cp-ledger.sh <bundle>` regenera el `Execution Ledger` y el índice de fragmentos de `PLAN.md` desde el `status` de `steps/*.md` y `findings/*.md`, de forma idempotente (marcadores `<!-- ledger:start -->` / `<!-- index:start -->`).
6. `assets/cp-context.sh <bundle> step A.1 | perspective N [steps…] | sweep fb|db|err | hub` imprime a stdout el paquete mínimo de lectura para ese actor (step + sus filas de registro + sus ADRs; perspectiva + brief del hub + registro de su dominio; etc.).
7. Un hallazgo de la flota vive en `findings/F-nnn.md`; en el step ocupa exactamente una línea de checklist cuyo estado cambia en sitio — el protocolo de escritura lo exige y `cp-lint` detecta la duplicación de un mismo `F-nnn` en un step.
8. Provider copies (`.claude/skills`, `.opencode/skills`, `.agent/skills`, `.agents/skills`) y `AGENTS.md`/`CLAUDE.md` quedan sincronizados sin diff residual respecto a `skills/`.

## Approach Chosen

**"Cero compactación, cero colocación."** No se recorta detalle: se reubica y se referencia por ID. El plan pasa de archivo a directorio con un hub pequeño (identidad, ledger generado, contexto, criticidad, objetivos, non-goals, enfoque, alternativas, blast radius, rollback e **índice de fragmentos con estado en una línea**) y fragmentos de un solo rol cada uno. Los fragmentos llevan frontmatter YAML **plano** (solo escalares y listas inline `[a, b]`) para que scripts bash+awk sin dependencias —el mismo patrón `extract_field` de `skills/skill-sync/assets/sync.sh`— parseen `id`, `status`, `contracts`, `severity` sin regex frágil. Cuatro scripts cierran el ciclo: `cp-new` (scaffold), `cp-lint` (estructura + presupuestos + refs cruzadas, falla duro), `cp-ledger` (ledger e índice generados → elimina el ledger rancio de raíz) y `cp-context` (paquete mínimo por actor → elimina el costo de la flota: 13 × 83k tokens por ronda pasa a 13 × ~6k). La skill misma se fragmenta con la misma lógica: `SKILL.md` conserva reglas, fases y protocolos; `references/` guarda plantillas, perspectivas, convergencia y checklist de validación. Gana porque ataca la causa (co-locación de roles + crecimiento inline) y no el síntoma, preserva la legibilidad en GitHub y el handoff "desde el archivo", y reutiliza convenciones ya presentes en el repo (`linear-issues/references/`, `skill-sync/assets/*.sh`, `docs/evidence/CP-*/`).

## Alternatives Considered

- **Compactar/resumir el plan (digest + detalle "bajo demanda" en el mismo archivo):** rechazado. Viola la regla "zero compaction" que da sentido a la skill; `Read` carga el archivo completo igual, así que no reduce tokens.
- **Un solo archivo con índice y anclas:** rechazado. Resuelve navegación humana, no carga de contexto; el ejecutor de A.3 sigue cargando las 13 perspectivas de F.1.
- **Base de datos (SQLite/JSON) para findings y registros:** rechazada. Deja de ser greppable y legible en GitHub; rompe la propiedad "si la persona desaparece, el siguiente retoma desde el archivo".
- **Scripts en Node o Python:** rechazados. `yq` no está instalado y el frontmatter plano hace innecesario un parser YAML real; bash+awk es el lenguaje de `sync.sh`/`setup.sh` y no introduce dependencias.
- **Migrar los 13 planes existentes:** rechazado por decisión del usuario (2026-09-05): solo planes nuevos. Los existentes quedan como histórico.

## Critical Files

- `skills/how-to-critical-plan/SKILL.md` — reescritura v2.0 (≤ 14 KB): reglas, 7 fases, protocolos de lectura/escritura, presupuestos, relación con dev, changelog.
- `skills/how-to-critical-plan/references/format.md` — estructura del bundle, plantillas comentadas, reglas de frontmatter plano, vocabulario de checkbox, rigor campo a campo de los 12 campos.
- `skills/how-to-critical-plan/references/perspectives.md` — las 13 perspectivas, severidades, plantilla de prompt adversarial, shape del finding devuelto.
- `skills/how-to-critical-plan/references/convergence.md` — loop, dedup contra lo registrado, log de convergencia, escalada a 6 rondas.
- `skills/how-to-critical-plan/references/validation-checklist.md` — checklist estructural/contratos/per-step/integridad/auditoría/documento vivo + presupuestos + anti-patrones (los de v1.1 más los nuevos de crecimiento inline).
- `skills/how-to-critical-plan/assets/cp-new.sh` — scaffold del bundle desde plantillas.
- `skills/how-to-critical-plan/assets/cp-lint.sh` — validador (exit 1 al fallar).
- `skills/how-to-critical-plan/assets/cp-ledger.sh` — regenerador de ledger e índice.
- `skills/how-to-critical-plan/assets/cp-context.sh` — ensamblador de contexto mínimo por actor.
- `skills/how-to-critical-plan/assets/templates/PLAN.md` — hub.
- `skills/how-to-critical-plan/assets/templates/step.md` — step con 12 campos.
- `skills/how-to-critical-plan/assets/templates/adr.md` — ADR.
- `skills/how-to-critical-plan/assets/templates/finding.md` — hallazgo.
- `skills/how-to-critical-plan/assets/templates/registry-fb.md` — registro Frontend↔Backend.
- `skills/how-to-critical-plan/assets/templates/registry-db.md` — registro Database.
- `skills/how-to-critical-plan/assets/templates/registry-err.md` — registro Error Codes.
- `skills/how-to-critical-plan/assets/templates/log-execution.md` — Execution Log.
- `skills/how-to-critical-plan/assets/templates/log-convergence.md` — Convergence Loop Log.
- `skills/how-to-critical-plan/assets/templates/inventory-files.md` — Critical Files.
- `skills/how-to-critical-plan/assets/templates/inventory-assets.md` — Reusable Assets.
- `docs/critical-plans/README.md` — nuevo, ≤ 2 KB: qué es un bundle, cómo leerlo en frío, qué script correr.
- `AGENTS.md` — generado por `sync.sh`; las 7 filas de `how-to-critical-plan` deben quedar iguales.
- `CLAUDE.md` — generado por `setup.sh`; sin edición manual.
- `.claude/skills/how-to-critical-plan/`, `.opencode/skills/how-to-critical-plan/`, `.agent/skills/how-to-critical-plan/`, `.agents/skills/how-to-critical-plan/` — copias generadas por `setup.sh --sync` (`cp -r`, incluye `assets/` y `references/`).

## Reusable Assets

- `skills/skill-sync/assets/sync.sh` (función `extract_field`, líneas 66-90) — patrón awk para leer un campo de frontmatter; base de los cuatro scripts `cp-*`.
- `skills/setup.sh` (`sync_skills_to_dir`, `cp -r "$skill_path"/*`) — ya copia subcarpetas; no requiere cambios para que `assets/` y `references/` lleguen a las provider copies.
- `skills/skill-creator/assets/SKILL-TEMPLATE.md` — plantilla de frontmatter/estructura para la reescritura de `SKILL.md`.
- `skills/linear-issues/references/*.md` — convención existente de `references/` para material de consulta bajo demanda.
- `skills/how-to-critical-plan/SKILL.md` v1.1 — fuente literal de las 13 perspectivas, severidades, cuatro modos de fallo de contrato, reglas de registros, vocabulario de checkbox y anti-patrones: se mueven a `references/`, no se reescriben.
- `docs/evidence/CP-tienda-checkout-whatsapp/` y `docs/evidence/cp-*/` — convención de evidencia por plan; el bundle la interioriza en `evidence/`.
- `skills/how-to-plan/SKILL.md` (Skill Selection Matrix, Verification Mechanisms Catalog) — heredados sin cambios por referencia, igual que en v1.1.

## Steps

1. Crear la rama de trabajo desde `origin/develop`
   Skills: git-workflow
   Resources: `git fetch origin develop && git checkout -b feat/how-to-critical-plan-v2-bundle origin/develop`
   Business decision: nunca se trabaja sobre `develop`; la aprobación de este plan es la autorización explícita para crear esta rama (regla del usuario: preguntar antes de crear ramas).
   Why: va primero porque todos los pasos siguientes escriben archivos; el árbol está limpio (`git status` vacío en `develop`).
   Output: rama `feat/how-to-critical-plan-v2-bundle` cuyo HEAD es `origin/develop`.
   Verification: `git rev-parse --abbrev-ref HEAD` imprime `feat/how-to-critical-plan-v2-bundle` y `git merge-base --is-ancestor origin/develop HEAD` devuelve 0.

2. Escribir las 11 plantillas del bundle en `assets/templates/`
   Skills: skill-creator
   Resources: none
   Business decision: frontmatter YAML **plano** (escalares y listas inline; sin anidación) con campos fijos por tipo — step: `id, title, phase, status, owner, updated, contracts, adrs, skills`; finding: `id, round, perspective, severity, step, status, accepted_by, location`; ADR: `id, title, status, reversibility, updated`; hub: `id, criticality, owner, created, updated, status, issue`. Los 12 campos del step van como líneas `- **Campo:**` en el orden de v1.1. Una fila de registro = una línea de tabla con el ID en la primera columna y `Status` como `[ ]`/`[x]`. `PLAN.md` lleva marcadores `<!-- ledger:start -->…<!-- ledger:end -->` e `<!-- index:start -->…<!-- index:end -->` para regeneración idempotente. Los ítems de checklist de un step que provienen de la flota tienen la forma exacta `- [ ] F-nnn — <título> (<severidad>)` y cambian de estado en la misma línea.
   Why: los scripts (paso 4) y las referencias (paso 3) se escriben contra estas plantillas; fijarlas primero evita reescrituras.
   Output: `assets/templates/{PLAN,step,adr,finding,registry-fb,registry-db,registry-err,log-execution,log-convergence,inventory-files,inventory-assets}.md`.
   Verification: `ls skills/how-to-critical-plan/assets/templates | wc -l` = 11; `grep -c '^- \*\*[A-Za-z ]*:\*\*' assets/templates/step.md` = 12; cada plantilla empieza con `---` y contiene un segundo `---` (`awk '/^---$/{c++} END{exit c<2}' <f>` devuelve 0 para las 11); `PLAN.md` contiene los cuatro marcadores.

3. Escribir `references/format.md`, `perspectives.md`, `convergence.md` y `validation-checklist.md`
   Skills: skill-creator
   Resources: none
   Business decision: el contenido de v1.1 que no cambia (13 perspectivas con "sample finding", severidades, cuatro modos de fallo, reglas de los tres registros, vocabulario de checkbox, rigor campo a campo, anti-patrones) se **mueve literalmente**, no se reescribe. Lo nuevo: presupuestos (hub 8k tokens · step 2,5k · ADR 1,5k · finding 800 · fila de registro 400 chars · fila de log 300 chars · ítem de checklist 200 chars; tokens ≈ bytes/4), protocolo de lectura por actor (tabla actor → carga), protocolo de escritura (finding de primera clase; una línea por hallazgo en el step; rationale largo → ADR o finding; detalle de log → `evidence/`; ledger nunca a mano), y cuatro anti-patrones nuevos: hallazgo con rationale inline en checklist, segunda línea `[x]` para cerrar un `[ ]`, fila de log narrativa, evidencia en `/tmp`. La `validation-checklist.md` remite a `cp-lint` para todo lo mecánico y conserva solo lo que requiere juicio humano.
   Why: después de las plantillas (porque `format.md` las explica) y antes de `SKILL.md` (que las referencia por ruta).
   Output: cuatro archivos en `skills/how-to-critical-plan/references/`.
   Verification: los 4 archivos existen; `grep -c '^| [0-9]* |' references/perspectives.md` = 13; `grep -c 'blocker\|major\|minor\|note' references/perspectives.md` ≥ 4; `grep -n '8k\|2,5k\|1,5k\|800\|400 chars\|300 chars\|200 chars' references/format.md` muestra los 7 presupuestos; cada H2/H3 de v1.1 (`git show HEAD:skills/how-to-critical-plan/SKILL.md | grep '^##'`) aparece por nombre en `SKILL.md` v2.0 o en algún `references/*.md` (`grep -rl`), sin excepciones.

4. Implementar `assets/cp-new.sh`, `cp-lint.sh`, `cp-ledger.sh` y `cp-context.sh`
   Skills: skill-creator — `[Knowledge gap: no existe skill para tooling bash dentro de skills; ver Knowledge Gaps]`
   Resources: `bash -n <script>` para sintaxis; `command -v shellcheck && shellcheck assets/cp-*.sh` si está instalado; patrón `extract_field` de `skills/skill-sync/assets/sync.sh:66-90`.
   Business decision: bash + awk, cero dependencias (sin `yq`, sin Node, sin Python). Presupuestos duros → `exit 1` con mensaje `LINT FAIL <archivo>: <regla> (<valor>/<límite>)`. `cp-lint` valida además: 12 campos por step, secciones obligatorias del hub, `status` dentro del vocabulario, cada `F-*`/`FB-*`/`DB-*`/`ERR-*`/`ADR-*` citado existe como archivo o fila, ningún `F-nnn` repetido dentro de un mismo step, ninguna ruta `/tmp/` en `log/` ni `steps/`. `cp-ledger` reescribe solo entre marcadores y cuenta por fase `steps / done / in-progress / blocked` desde frontmatter; añade `Last updated` con la fecha del día. `cp-context` imprime a stdout con cabeceras `===== <ruta> =====`; modos: `hub` (PLAN.md), `step <id>` (step + filas de registro cuyo ID aparece en `contracts` + ADRs en `adrs`), `perspective <n> [ids…]` (secciones Context/Objetivos/Blast Radius del hub + registro del dominio: 3→fb, 4→db, 5→err, resto ninguno + steps indicados), `sweep fb|db|err` (solo ese registro).
   Why: depende de las plantillas (paso 2); precede a `SKILL.md` porque este documenta los comandos exactos.
   Output: cuatro ejecutables (`chmod +x`) en `skills/how-to-critical-plan/assets/`.
   Verification: `for s in skills/how-to-critical-plan/assets/cp-*.sh; do bash -n "$s" && test -x "$s"; done` devuelve 0 para los cuatro; el fixture del paso 5 pasa.

5. Verificar los scripts contra un fixture en el scratchpad (no se commitea)
   Skills: how-to-test
   Resources: `S=skills/how-to-critical-plan/assets; B=<scratchpad>/CP-fixture; bash $S/cp-new.sh CP-fixture --dir <scratchpad>` · `bash $S/cp-lint.sh $B; echo $?` · `bash $S/cp-ledger.sh $B && grep -A6 'ledger:start' $B/PLAN.md` · `bash $S/cp-context.sh $B step A.1 | grep '^====='`
   Business decision: happy path + sad path obligatorios; un validador que solo se probó en verde no se ha probado (memoria: "un build o sonda pasa en verde y hay dudas de que la cobertura sea real").
   Why: es la única verificación real del paso 4 y debe pasar antes de documentar los comandos en `SKILL.md`.
   Output: fixture con 2 steps (`A.1`, `A.2`), 1 ADR, 2 findings (uno `open` → `A.1`, uno `fixed` → `A.2`), 3 filas por registro; y evidencia de los exit codes en `<scratchpad>/cp-fixture-evidence.txt`.
   Verification: happy path — `cp-lint` exit 0; `cp-ledger` produce fila `A | 2 | 1 | 1 | 0` tras poner `A.2` en `done` y `A.1` en `in-progress`; `cp-context step A.1` incluye `steps/A.1-*.md`, exactamente las filas `FB/DB/ERR` listadas en su `contracts` y su ADR, y **no** incluye `A.2` ni `findings/`. Sad path (cada uno exit 1 con su mensaje): step inflado a 10.300 bytes; `- [ ] F-999 — x (major)` en `A.1` sin `findings/F-999.md`; fila de registro de 401 chars; el mismo `F-001` dos veces en `A.1`; una ruta `/tmp/x.txt` en `log/execution.md`; `status: terminado` fuera de vocabulario.

6. Reescribir `skills/how-to-critical-plan/SKILL.md` a v2.0 (≤ 14 KB)
   Skills: skill-creator, skill-sync
   Resources: `wc -c skills/how-to-critical-plan/SKILL.md`
   Business decision: **intacto** — invocación explícita (dos triggers, "complex is not critical", nunca auto-escalar, downgrade), los 7 `auto_invoke`, los 12 campos, las 13 perspectivas, los 3 registros completos, dos rondas limpias consecutivas, `Approval Request` literal. **Nuevo** — Core Rule "cero compactación, cero colocación"; Fase 5 produce un bundle con `cp-new` y pasa `cp-lint` antes de pedir aprobación; Fase 7 obliga `cp-ledger` al cerrar cada step y `cp-lint` antes de marcar una fase completa; la flota recibe su paquete vía `cp-context perspective`; los ejecutores reciben `cp-context step`; el protocolo de lectura/escritura vive en `SKILL.md` en forma de tabla y los detalles en `references/`; sección `Related Skills` añade `how-to-test`; `Changelog` v2.0 explica el diagnóstico (tamaños medidos) y lo que se movió a dónde. `version: "2.0"` en frontmatter.
   Why: último de los artefactos porque cita rutas de `references/` y comandos de `assets/` que ya deben existir y estar verificados.
   Output: `SKILL.md` v2.0.
   Verification: `wc -c` ≤ 14336; `grep -c 'auto_invoke' -A7 SKILL.md` conserva las 7 entradas literales de v1.1 (`diff <(git show HEAD:skills/how-to-critical-plan/SKILL.md | sed -n '11,18p') <(sed -n '11,18p' SKILL.md)` vacío); `for f in $(grep -o 'references/[a-z-]*\.md\|assets/cp-[a-z]*\.sh' SKILL.md | sort -u); do test -f skills/how-to-critical-plan/$f || echo MISSING $f; done` no imprime nada; `grep -c 'cp-new\|cp-lint\|cp-ledger\|cp-context' SKILL.md` ≥ 4.

7. Crear `docs/critical-plans/README.md`
   Skills: skill-creator
   Resources: none
   Business decision: la persona que abre `docs/critical-plans/` en frío debe entender el bundle sin cargar la skill: qué es `PLAN.md`, qué hay en cada subcarpeta, y los cuatro comandos. Los archivos `CP-*.md` monolíticos existentes se mencionan como formato v1 histórico, sin migración.
   Why: cierra el handoff humano; después de `SKILL.md` para que ambos usen el mismo vocabulario.
   Output: `docs/critical-plans/README.md` ≤ 2 KB.
   Verification: `wc -c docs/critical-plans/README.md` ≤ 2048; menciona los cuatro scripts (`grep -c 'cp-new\|cp-lint\|cp-ledger\|cp-context'` ≥ 4).

8. Sincronizar la skill a `AGENTS.md`, `CLAUDE.md` y provider copies
   Skills: skill-sync
   Resources: `./skills/skill-sync/assets/sync.sh` · `./skills/setup.sh --sync` · `./skills/skill-sync/assets/sync.sh` (segunda pasada, según el Required Workflow de `skill-sync`)
   Business decision: nunca editar copias generadas; `skills/` es la única fuente. Las 7 filas de `how-to-critical-plan` en `AGENTS.md` deben quedar idénticas porque `auto_invoke` no cambió.
   Why: va después de todos los artefactos para sincronizar una sola vez.
   Output: provider copies con `SKILL.md` + `assets/` + `references/`; `AGENTS.md`/`CLAUDE.md` regenerados.
   Verification: `for d in .claude .opencode .agent .agents; do diff -rq skills/how-to-critical-plan $d/skills/how-to-critical-plan; done` sin salida; `grep -c 'how-to-critical-plan' AGENTS.md` igual al valor previo (`git show HEAD:AGENTS.md | grep -c 'how-to-critical-plan'`); `git status --short` solo lista rutas bajo `skills/how-to-critical-plan/`, las cuatro carpetas de provider copies, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `docs/critical-plans/README.md` y este plan.

9. Memoria Engram, commit, push y PR a `develop`
   Skills: git-workflow, vendix-engram, pr-code-review
   Resources: `mem_save` (project `vendix`) · `git add -- skills/how-to-critical-plan docs/critical-plans/README.md docs/plans/PLAN-how-to-critical-plan-v2-bundle.md AGENTS.md CLAUDE.md GEMINI.md .github/copilot-instructions.md .claude/skills/how-to-critical-plan .opencode/skills/how-to-critical-plan .agent/skills/how-to-critical-plan .agents/skills/how-to-critical-plan` · `git commit` · `git push -u origin feat/how-to-critical-plan-v2-bundle` · `gh pr create --base develop`
   Business decision: RULE 7 (memoria antes del push) y RULE 8 (`pr-code-review` ≥ 80%) de `git-workflow`; `git add` por rutas explícitas, nunca `-A` (memoria: `add -A` arrastra untracked ajenos). Commit tipo `feat(skills): how-to-critical-plan v2.0 — bundle fragmentado con cp-* tooling`.
   Why: cierre del flujo; solo después de que el paso 8 deje el árbol sincronizado.
   Output: commit, rama remota, PR con descripción (diagnóstico con cifras, decisiones del usuario, mapa v1.1 → v2.0).
   Verification: `gh pr view --json url,baseRefName` muestra `baseRefName: develop`; `pr-code-review` reporta ≥ 80%; la memoria aparece en `mem_search "critical plan bundle" --project vendix`.

## End-to-End Verification

1. **Pipeline completo sobre el fixture** (integra pasos 2, 4, 5): `cp-new` → `cp-lint` (0) → editar `status` de dos steps y añadir un finding → `cp-ledger` → `cp-lint` (0) → `cp-context step A.1` y `cp-context perspective 3 A.1` producen paquetes cuyo `wc -c` es ≤ 25% del `wc -c` total del bundle.
2. **Contabilidad de tokens antes/después** (proxy bytes/4): v1.1 orquestador en frío = `SKILL.md` 40.397 B + plan QUI-727 333.316 B ≈ 93k tokens; v2.0 = `SKILL.md` ≤ 14.336 B + `PLAN.md` ≤ 32.768 B ≈ ≤ 11,8k tokens. Se calcula con `wc -c` sobre los archivos reales y se anota en la descripción del PR.
3. **Carga de la skill en sesión limpia**: `Skill(how-to-critical-plan)` devuelve el `SKILL.md` v2.0 (≤ 14 KB) y ninguna `references/*.md` hasta que se lea explícitamente; comprobado observando el tool result.
4. **Sincronización sin residuo** (paso 8): `diff -rq` vacío en las cuatro provider copies y `git status --short` acotado a las rutas esperadas.
5. **Revisión de PR**: `pr-code-review` ≥ 80% sobre la rama antes del merge.

## Knowledge Gaps

- **Tooling bash dentro de skills**: `skill-sync/assets/sync.sh`, `product-catalog-normalizer/assets/*.py` y ahora `how-to-critical-plan/assets/cp-*.sh` repiten el patrón "skill con ejecutables" sin guía (dónde viven, cómo se documentan en `SKILL.md`, cómo se verifican, convención de exit codes y mensajes). Propuesta: añadir una sección "Assets ejecutables" a `skill-creator` vía `skill-creator` tras estabilizar este PR.
- **`how-to-plan` pesa 34 KB**: la misma fragmentación (`SKILL.md` núcleo + `references/` para Skill Selection Matrix, Verification Catalog, Field-by-Field Rigor) aplicaría y reduciría ~8k tokens por plan normal. Fuera de este plan; proponer como seguimiento.
- **`how-to-dev` no conoce el bundle**: hoy dice "follow the approved plan"; conviene una línea que remita a `cp-context step <id>` cuando el plan sea un bundle. Fuera de alcance aquí (un cambio de una línea a decidir con el usuario).

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
