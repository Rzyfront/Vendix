# R.2 — Matriz normativa DIAN para F-010 (nota parcial sin `taxes`)

- **Verdict:** POR ACEPTAR ADR-06 — omitir `taxes` en el payload parcial es
  normativamente seguro en el contrato actual (detalle abajo).
- **Fecha:** 2026-09-11 · Rama: `develop` (solo lectura; sin cambios de código)

## 1. Traza completa verificada (archivos:líneas en `develop`)

| Tramo | Evidencia |
|---|---|
| `buildNotePayload` (scope partial → SOLO `items`) | `apps/frontend/.../invoice-note-create/invoice-note-payload.util.ts`, header + `buildNotePayload` final (`...base, items: buildNoteItems(selections)`; comentario cita `derivePartialNoteLinesViaKernel` y F-073) |
| DTO acepta la omisión | `credit-notes/dto/create-credit-note.dto.ts:155-161` y `:243-249`: `items?` y `taxes?` ambos `@IsOptional()` en nota crédito Y débito |
| Kernel deriva (ruta sin `taxes`) | `credit-notes.service.ts:339-356`: `!dto.taxes?.length && is_partial ? derivePartialNoteLinesViaKernel(items, related.invoice_items, related.invoice_taxes, ...) : null`; cabecera suma lo derivado (`:363-370`), todo en `Decimal` |
| Kernel preserva tipo fiscal | `derivePartialNoteLinesViaKernel` (`:629-899`): `scheme = invoice_taxes[0]`, `scheme_type = tax_type ?? 'iva'` (`:760-761`); cuota por `absorbInclusiveLine` (trunc, misma que el motor); salida `taxes: [{ tax_rate_id, tax_name, tax_rate, taxable_amount, tax_amount, tax_type: scheme.tax_type }]` (`:888-898`); persistencia con `tax_type ?? 'iva'` (`:488`) |
| Emisión | `invoicing.controller.ts:383-388` `POST :id/issue` → `issueNote` (valida + envía en un shot, `credit-notes.service.ts:109-131`) |
| UBL cabecera (total-level) | `ubl-credit-note.builder.ts:184` `buildTaxTotals(doc, taxes)` — agrupa por (esquema, tarifa), `tax_type`-aware vía `resolveTaxCodeFromTax → resolveDianTaxSchemeCode` (`dian-tax-codes.ts`: iva→01, inc→04, ica→03, reteiva→05, retefuente→06, reteica→07); ND idéntico (`ubl-debit-note.builder.ts:205`, con `RequestedMonetaryTotal`) |
| UBL línea (line-level) | `buildDocumentLines(items, taxes, ...)` (`ubl-credit-note.builder.ts:213-220`); sin `line_taxes` persistidas la línea hereda el esquema primario — correcto solo para tributo único, garantizado porque multi-tributo persiste desglose (`needsPersistedLineTaxes`, comentario en `ubl-common.builder.ts:2326-2342`); regla CAS01b cubierta |

## 2. Línea vs total ante DIAN (conocimiento in-repo)

- FAS02: `TaxTotal` de cabecera = Σ de sus `TaxSubtotal` — se cumple por
  construcción: cabecera y líneas beben de las mismas filas `invoice_taxes`
  derivadas por el kernel.
- FAX02 (por línea y esquema) + FAS01a/b (línea vs cabecera por tributo): el
  builder emite un bloque por esquema con importe = Σ de sus subtotales y el
  mismo par (ID, Name) en línea y cabecera (`ubl-common.builder.ts:2364-2370,
  1489-1560`).
- Tabla de tributos verbatim `TipoImpuesto-2.1.gc` + §11 CUFE
  (IVA=01, INC=04, ICA=03) en `dian-tax-codes.ts:1-30`; IBUA/ICUI y códigos
  32-36 declarados PENDIENTES sin adivinar — fuera del alcance de este contrato.

## 3. Fail-closed: el caso peligroso no puede emitirse

`credit-notes.service.ts:746-758`: si la factura mezcla N impuestos y las líneas
solo traen el importe total, el kernel LANZA `INVOICING_CALC_001` exigiendo el
desglose explícito en `taxes` (igual si la factura no tiene impuestos). La
omisión es segura porque el único caso que el kernel no puede derivar no
persiste ni llega al UBL: devuelve 400 con mensaje accionable antes de firmar.

## 4. Specs en verde (ejecutados en esta sesión)

- `credit-notes.b1-partial-kernel.spec.ts` + `credit-notes.service.issue.spec.ts`:
  2 suites, 16/16 PASS.
- `ubl-credit-note.builder.spec.ts` + `dian-totals.validator.spec.ts`:
  2 suites, 58/58 PASS.
- Sin spec frontend para `buildNotePayload` (no existe `*.spec.ts` en
  `invoice-note-create/`): el contrato vive cubierto del lado backend.

## 5. Recomendación ADR-06: ACCEPT

El header actual de `invoice-note-payload.util.ts` (commit `efecea5e5`) ya
describe el contrato validado aquí; F-010 queda cerrado como solo-doc. Contrato
validado (citar al aceptar ADR-06):

> **Contrato NC/ND parcial:** `scope === 'partial'` envía SOLO `items`, nunca
> `taxes`. El servidor deriva impuestos y totales por
> `derivePartialNoteLinesViaKernel` (Decimal, cuota `trunc(base × tasa)` vía
> `absorbInclusiveLine`, `tax_type` preservado de `invoice_taxes`); la cabecera
> suma lo derivado, nunca el reclamo del cliente. Factura multi-tributo sin
> desglose explícito ⇒ `INVOICING_CALC_001` (fail-closed, sin emisión). El UBL
> agrupa cabecera por (esquema DIAN, tarifa) y emite `TaxTotal` por línea
> (CAS01b). Quien necesite un desglose distinto al derivado usa el camino
> explícito del DTO (`taxes` con `taxable_amount` + `tax_amount` exigidos) a
> propósito, no este formulario.

Revisar si: la DIAN actualiza el anexo de NC/ND, aparecen IBUA/ICUI (códigos
32-36 pendientes en `dian-tax-codes.ts`), o una nota parcial multi-tributo
necesita derivación automática (hoy exige `taxes` explícito por diseño).
