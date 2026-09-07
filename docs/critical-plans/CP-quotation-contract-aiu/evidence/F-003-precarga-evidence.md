# Evidencia F-003 — precarga por perfil

Fecha: 2026-09-06. Ejecutor: orquestador.

Hallazgo: el catalogo solo trae {id, name, is_default, current_version} pero
el modal leia `contract_object`/`terms` del item (precarga muerta), y el
backend ignoraba `profile_id` (con `forbidNonWhitelisted` era 400).

Fix:
- `CreateQuotationDto.profile_id` (IsInt, Min 1) + `QuotationsModule`
  importa `QuotationProfilesModule`.
- `create()` resuelve el perfil (tenant-gated), persiste `profile_id` y
  rellena solo vacios: terms←payment_terms, notes←notes,
  valid_until←hoy+validity_days.
- Modal: `onProfileSelect` pide `GET /store/quotation-profiles/:id`
  (`current_config`) y pinta; fallo degrada a desde cero. Interfaz del
  catalogo sincerada (solo identificacion).
- Spec `quotations.profile-preload.spec.ts` (precarga, prioridad a lo
  digitado, sin perfil intacto): runner del repo PASS con gates (61s),
  exit 0, 2026-09-06 07:06:32Z.
