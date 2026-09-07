# Barrido E.1 — ronda 1 (2026-09-06, orquestador)

## Verificado directo
- Rutas vivas en arranque dev: 5/5 contracts (GET base, GET :id, PATCH :id,
  POST from-quotation, POST :id/invoice) + CRUD profiles + versions.
  Health 200, 0 errores nuevos en logs.
- DB dev: 0 quotations sin destination, 0 contracts sin quotation;
  existen quotation_profile_versions, invoices.contract_id,
  uniques contracts_quotation_id_key, invoices_contract_id_active_uq,
  contracts_store_number_uq.
- Specs (runner del repo, exit 0): dominios contracts + quotations (34s),
  specs invoice de filtro/duplicado, gates y precarga.
- Backend tsc PASS (14s). Frontend: ningun archivo mas nuevo que el ultimo
  ciclo OK sin errores.
- Codigos ERR-01/04/05/06/07 en catalogo central + specs que los provocan.

## Pendiente (requiere sesion autenticada o accion Codul)
- FB-01/05/09/10/11 y ERR-02/03 contra API viva con usuario construction.
- E2E completo en UI: perfil → cotizacion con linea libre → contrato →
  factura AIU (el dueno lo corre en el navegador).
- Karma frontend (sin Chrome en esta maquina).
