## Context
La carga de certificado `.p12` en la configuración DIAN (store-scope y org-scope) rechaza con `DIAN_CERT_004` ("El certificado no coincide con el NIT de la entidad fiscal") aunque el certificado pertenezca al mismo NIT del formulario. Causa raíz: los certificados de firma DIAN para persona jurídica encodean el NIT en el atributo `serialNumber` del subject **con el dígito de verificación (DV) pegado** (ej. `9020565899` = NIT `902056589` + DV `9`), mientras el formulario guarda el NIT base (9 díg.) y el DV aparte (`nit_dv`). La comparación actual es estricta (`!==`) y además `extractTaxId` toma el primer número de 6–12 dígitos de todo el subject (heurística ciega). Objetivo: aceptar el certificado cuando el NIT coincide salvo el DV, y extraer el NIT del campo correcto.

## General Objective
La validación de certificado DIAN acepta el `.p12` cuando su NIT corresponde a la entidad fiscal, tolerando la presencia/ausencia del dígito de verificación.

## Specific Objectives
1. Existe un comparador único DV-tolerante reutilizado por adapter y servicios (sin lógica duplicada).
2. `extractTaxId` prioriza el atributo `serialNumber` (OID `2.5.4.5`) del subject, con fallback a la heurística actual.
3. Los 3 call-sites del adapter pasan el `nit_dv` de la config para comparación exacta base+DV.
4. Los 3 chequeos secundarios de NIT (store `updateCertificate`, org `updateCertificate`, `fiscal-production-readiness`) usan el comparador DV-tolerante.
5. El backend compila sin errores y el spec existente de readiness sigue verde.

## Approach Chosen
Comparador puro en una util compartida (`certificateNitMatches`) + extracción dirigida al `serialNumber`. La util normaliza a dígitos y acepta match si: `cert === base`, `cert === base+dv`, o `cert` es `base` con exactamente un dígito extra al final (DV desconocido). El adapter recibe `expected_dv` opcional; los servicios pasan `config.nit_dv`. Centralizar en una util evita reimplementar la tolerancia en 5 lugares y mantiene una sola fuente de verdad.

## Alternatives Considered
- **Solo tolerar en el adapter, dejar los servicios con `!==`**: rechazado — el readiness gate y los `updateCertificate` volverían a fallar con el NIT+DV ya guardado en `certificate_nit`.
- **Quitar la verificación de NIT**: rechazado — es un control de seguridad fiscal legítimo (evita subir el cert de otra entidad); solo debe ser DV-tolerante.
- **Normalizar quitando el último dígito siempre**: rechazado — NITs no tienen longitud fija; truncar a ciegas corrompería NITs sin DV.

## Critical Files
- `apps/backend/src/domains/store/invoicing/dian-config/certificates/nit-match.util.ts` — NUEVO: `normalizeNitDigits` + `certificateNitMatches`.
- `apps/backend/src/domains/store/invoicing/dian-config/certificates/certificate-issuer.interface.ts` — añadir `expected_dv?: string | null` a los params.
- `apps/backend/src/domains/store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter.ts` — extracción serialNumber-first + match DV-tolerante.
- `apps/backend/src/domains/store/invoicing/dian-config/dian-config.controller.ts` — pasar `expected_dv: config.nit_dv` (≈línea 140).
- `apps/backend/src/domains/organization/invoicing/dian-config/dian-config.controller.ts` — pasar `expected_dv: config.nit_dv` (≈línea 120).
- `apps/backend/src/domains/superadmin/subscriptions/fiscal/subscription-fiscal.service.ts` — pasar `expected_dv: config.nit_dv` (≈línea 233).
- `apps/backend/src/domains/store/invoicing/dian-config/dian-config.service.ts` — check secundario DV-tolerante (≈líneas 397-412).
- `apps/backend/src/domains/organization/invoicing/dian-config/dian-config.service.ts` — check secundario DV-tolerante (≈líneas 258-273).
- `apps/backend/src/domains/store/invoicing/providers/fiscal-production-readiness.service.ts` — check DV-tolerante (≈líneas 124-135).

## Reusable Assets
- `apps/backend/src/domains/store/invoicing/providers/fiscal-production-readiness.service.spec.ts` — spec existente que cubre `DIAN_CERT_004`; sirve de red de regresión.
- `onlyDigits(...)` ya presente en adapter y servicios — se reemplaza por la util compartida para unificar.

## Steps
1. Crear util de matching NIT/DV
   Skills: vendix-fiscal-scope, vendix-backend-domain, vendix-naming-conventions
   Resources: none
   Business decision: el NIT del certificado corresponde a la entidad si coincide la base, o la base+DV, o la base con un único dígito de verificación extra.
   Why: base compartida que consumen adapter y servicios; va primero porque todos dependen de ella.
   Output: `nit-match.util.ts` con `normalizeNitDigits()` y `certificateNitMatches({ certificateTaxId, nit, dv })`.
   Verification: `docker exec ... npx ts-node --transpile-only` con casos `(9020565899, 902056589, 9)→true`, `(902056589, 902056589, 9)→true`, `(123456789, 902056589, 9)→false`.

2. Mejorar extracción del NIT en el adapter + match DV-tolerante
   Skills: vendix-fiscal-scope, vendix-backend-domain
   Resources: none
   Business decision: el NIT de la persona jurídica vive en `serialNumber` (OID 2.5.4.5); solo si falta se usa la heurística de subject.
   Why: corrige la extracción equivocada y aplica la tolerancia en el punto primario de rechazo (adapter línea 45).
   Output: `extractTaxId` lee `serialNumber` primero; `validateCertificate` usa `certificateNitMatches` con `expected_dv`; interface ampliada.
   Verification: backend compila (`docker logs vendix_backend`); el caso real (902056589 + DV9) deja de lanzar "does not match".

3. Propagar `nit_dv` desde los 3 call-sites
   Skills: vendix-backend-domain, vendix-multi-tenant-context
   Resources: none
   Business decision: cada flujo de subida (store, org, superadmin) ya conoce el DV de su config y debe entregarlo al validador.
   Why: sin el DV el adapter solo puede tolerar el dígito extra genérico; pasarlo permite match exacto base+DV.
   Output: las 3 llamadas incluyen `expected_dv: config.nit_dv`.
   Verification: backend compila; grep confirma `expected_dv` en los 3 sitios.

4. Unificar los 3 checks secundarios de NIT
   Skills: vendix-fiscal-scope, vendix-backend-domain
   Resources: none
   Business decision: el gate de readiness y los `updateCertificate` deben usar la misma regla DV-tolerante para no re-bloquear lo que el adapter ya aceptó.
   Why: `certificate_nit` se persiste tal cual (con DV); sin tolerancia, readiness y re-guardado fallarían igual.
   Output: store/org `updateCertificate` y `fiscal-production-readiness` usan `certificateNitMatches` (pasando `config.nit_dv`).
   Verification: backend compila; `DIAN_CERT_004` solo se lanza cuando el NIT base difiere realmente.

## End-to-End Verification
1. Compilación dev: `docker logs --tail 60 vendix_backend` muestra "Nest application successfully started" sin errores TS tras los cambios.
2. Unit de la util vía ts-node con la matriz de casos del Step 1 (incluye el caso real `9020565899` vs `902056589/9`).
3. Regresión: `docker exec -w /app vendix_backend npx jest --runInBand src/domains/store/invoicing/providers/fiscal-production-readiness.service.spec.ts` sigue verde (el caso de mismatch usa un NIT genuinamente distinto).
4. Validación funcional: el usuario re-sube el `.p12` de Quickss (NIT 902056589) en `Manejo fiscal → DIAN`; ya no aparece `DIAN_CERT_004`.

## Knowledge Gaps
None.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
