# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | POST /quotations | +destination,profile_id? | Quotation+destination | quotation-form-modal | + fields optional | field-of-more 400 | curl POST con/sin campos vs interface | [ ] |
| FB-02 | GET modules + contracts API | store industries | menu visible? + 403? | panel menu, guards | visibility by industry | optionality leak | store sin construction: menu oculto y 403 | [ ] |
| FB-03 | GET /quotation-profiles/catalog | none | Profile[](active) | selector perfil | new endpoint | type mismatch list | curl keys vs TS interface | [ ] |
| FB-04 | CRUD /quotation-profiles | name,config,state | Profile+version | perfiles page | new endpoints | field-of-less | curl cada verbo vs interface | [ ] |
| FB-05 | POST /quotations (perfil) | profile_id | Quotation precargada | form modal | uses FB-03 data | stale catalog id | POST con id ajeno da 400/403 | [ ] |
| FB-06 | POST /contracts/from-quotation/:id | none | Contract | ficha contrato | new endpoint | double create | doble POST: 1 crea, 2do 409 | [ ] |
| FB-07 | GET/PATCH /contracts/:id | status transition | Contract | ficha contrato | new endpoints | invalid transition | PATCH invalido da 422 visible | [ ] |
| FB-08 | POST /contracts/:id/invoice | none | Invoice draft | boton factura | new endpoint | double invoice | doble POST: 1 crea, 2do 409 | [ ] |
| FB-09 | GET /invoices?contract_id= | query | Invoice[] | ficha contrato | + query | empty vs missing | curl con/sin factura ligada | [ ] |
| FB-10 | POST /quotations/:id/convert | none | Quotation converted | detalle cotizacion | none (regression) | gate bypass | destino contract rechaza explicito | [ ] |
| FB-11 | POST /invoices/from-order/:id | none | Invoice | facturacion | none (regression) | order shape drift | orden de cotiz venta factura igual | [ ] |
| FB-12 | POST/PATCH /quotations (linea) | item sin product_id | item libre | form modal | + item libre | totales al convertir | convertir y comparar totales | [ ] |
