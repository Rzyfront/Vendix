# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `POST /shipping/calculate?store_id=:id` | `CalculateShippingDto` | `ShippingOption[]` | `checkout.component.ts:1707` | Retorna opciones multi-zona consolidadas por método | Ninguno, shape idéntico | `curl -X POST ...` devuelve tarifas de múltiples métodos | [ ] |
| FB-02 | `POST /store/shipping-zones` | `CreateZoneDto` | `{ data: ShippingZone }` | `zone-modal.component.ts:438` | Sin cambio de contrato | Incompatibilidad de campos | Formulario crea zona con país, región, ciudad | [ ] |
| FB-03 | `POST /store/shipping-zones/rates` | `CreateRateDto` | `{ data: ShippingRate }` | `add-rate-wizard-modal.component.ts:270` | Sin cambio de contrato | Error en validación DTO | Formulario crea tarifa en zona existente | [ ] |
| FB-04 | `GET /store/shipping-zones` | none | `{ data: ShippingZone[] }` | `shipping-methods.service.ts:288` | Sin cambio de contrato | Zonas no listadas | GET lista zonas con conteo de tarifas | [ ] |
