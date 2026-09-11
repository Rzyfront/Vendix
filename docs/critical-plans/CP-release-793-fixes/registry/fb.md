# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `PATCH /store/ecommerce/footer` | `{ footer }` | `{ ok, footer }` | `ecommerce.component.ts:saveFooterOnly` | none — se evita el doble envio | Doble toast si regresa | Guardar footer: 1 toast en evidence/ | [ ] |
| FB-02 | `PATCH /store/ecommerce` | `{ ..., footer? }` | `{ ok, settings }` | `ecommerce.component.ts` save general | `footer` omitido si ya se guardo solo | Sobrescribir footer | Save general tras footer-only: footer intacto | [ ] |
| FB-03 | `GET /public/pqr/track?ticket=` | `ticket: string` | PQR publica o 404 | `pqr-track.component.ts` | Gate plataforma reaplicado | Enumeracion cross-tienda | curl tienda→404, plataforma→200 | [ ] |
| FB-04 | `POST /store/pqr/:id/comments` | `{ body, is_internal, notify_requester }` | `{ ok, comment }` | `pqr-detail-page.component.ts` | Solo defaults UI, misma forma | Fail-open de aviso | Composer abre interno sin aviso | [ ] |
| FB-05 | `GET /store/analytics/abandoned*` | `{ range, granularity }` | summary/trends/rows | `abandoned-carts.component.ts` | Misma forma, filas derivadas | Salto de ~0 a real | SQL before/after + render sin regresion | [ ] |
| FB-06 | `GET /store/shipping/rates` | `{ postal_code? }` | `[{ rate_id, cost, postal_code_match }]` | `checkout.component.ts:1766` | none — solo comentario | Preseleccion no cambiable | Cambiar tarifa sugerida sin bloqueo | [ ] |
