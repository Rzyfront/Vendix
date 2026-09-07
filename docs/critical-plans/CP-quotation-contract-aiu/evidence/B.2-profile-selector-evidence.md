# Evidencia B.2 — Selector de perfil en frontend

- Step: B.2 (contracts FB-03, FB-05)
- Rama: develop. Alcance respetado: solo `interfaces/quotation.interface.ts`,
  `services/quotations.service.ts` y `components/quotation-form-modal/` (frontend).
  Sin backend, sin steps ajenos, sin PLAN.md, logs ni registries.
- Decision de alcance: B.1 (backend de perfiles) sigue pendiente — verificado por
  grep: cero ocurrencias de `quotation-profile(s)` / `quotation_profiles` en
  `apps/backend/src`. El frontend degrada sin bloquear, como exige el step.

## Cambios

1. `interfaces/quotation.interface.ts`
   - `QuotationDestination = 'sale' | 'contract' | 'other'` (espejo del enum A.1).
   - `QuotationProfileCatalogEntry` — entrada liviana del catalogo (id+nombre;
     `is_default`, `current_version`, `state` y campos de precarga opcionales),
     espejo de `InvoiceProfileCatalogEntry`.
   - `Quotation`: `destination?` + `profile_id?: number | null` (solo lectura).
   - `CreateQuotationDto`: `destination?` (omitido = backend aplica `sale`) +
     `profile_id?` (omitido = desde cero; id ajeno/inactivo dara 400/403 en B.1).
2. `services/quotations.service.ts` — `getQuotationProfileCatalog()` contra
   `GET /store/quotation-profiles/catalog` (mismo prefijo `/store` que el resto del
   modulo). NO traga errores: el llamador degrada ante 404/catalogo caido.
3. `components/quotation-form-modal/quotation-form-modal.component.ts`
   - Controles nuevos: `destination` (default `'sale'`) + `profile_id` (`''` = sin perfil).
   - Template: selector de destino (Venta/Contrato/Otro) + selector de perfil con
     estados carga/error; sin catalogo muestra "no disponible — cotizando desde cero".
   - `onProfileSelect`: rellena solo campos vacios (objeto→notas, condiciones,
     notas→internas). A/I/U e items los precarga el backend (FB-05); por eso
     `profile_id` viaja aunque el modal no tenga campos AIU.
   - `onSave`: `destination` solo al crear (en edicion se omite; controles
     deshabilitados via `getRawValue`, ADR-01); `profile_id` string→number, se omite si vacio.
   - Edicion: destino y perfil deshabilitados con etiqueta "(fijo, no editable)".

## Verificacion (salidas reales)

- `npx tsc --noEmit -p apps/frontend/tsconfig.app.json`: EXIT 0, cero errores.
- `bash scripts/buildcheck.sh --frontend` (ngc AOT + strictTemplates):
  `frontend-typecheck PASS (23s)` / `RESULTADO: PASS — compila y no quedó ningún proceso vivo.`
- `grep -rn "quotation-profile|quotation_profiles" apps/backend/src`: cero resultados
  (catalogo B.1 ausente confirmado — base de la degradacion).
- `git diff --stat`: 3 archivos, 211 inserciones / 1 borrado, todo dentro del alcance.

## Checklist del step

- [x] Sin perfil el formulario funciona igual que hoy.
- [x] Destino se elige al crear y luego se muestra bloqueado.
- [ ] Con perfil precarga A/I/U, objeto y condiciones — frontend listo, precarga
  servidor pendiente de B.1 (sin endpoint contra el que probar).

## Gaps honestos / handoff

- E2E contra API viva (crear con/sin perfil, comparar payloads; catalogo caido no
  bloquea) NO ejecutado: requiere B.1 (endpoint inexistente hoy). Cubierto a nivel
  tipos + AOT + revision de ramas de error en su lugar.
- Claves exactas del catalogo real pueden diferir (B.1 define el contrato); la interfaz
  tolera campos ausentes y el relleno solo actua sobre claves presentes.
- `QuotationFormModalComponent` no tiene consumidores en templates hoy (el flujo actual
  navega a POS `mode=quotation`); el cambio queda compilado y listo para cuando el flujo
  lo monte, sin alterar el flujo vigente.
- Registries (`registry/fb.md` Status `[ ]`), `log/execution.md` y `PLAN.md` (ledger)
  NO tocados por prohibicion del workflow; quedan para el orquestador.
