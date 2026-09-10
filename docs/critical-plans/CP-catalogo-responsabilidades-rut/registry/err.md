# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `ORGANIZATION_INVALID_FISCAL_RESPONSIBILITY` | 400 | Código no está en catálogo RUT | Marca formulario inválido y toast | "fiscal_responsibilities contiene códigos fuera del catálogo RUT" | `curl -X PATCH -d '{"tax_responsibilities":["FAKE"]}' http://localhost:3000/organization/settings/fiscal-data` | [x] |
| ERR-02 | `CUSTOMER_INVALID_FISCAL_RESPONSIBILITY` | 400 | Responsabilidad de cliente no válida | Muestra error en campo de cliente | "Responsabilidad fiscal fuera de catálogo" | `curl -X POST -d '{"fiscal_responsibilities":["FAKE"]}' http://localhost:3000/store/customers` | [x] |
| ERR-03 | `RUT_SCAN_EXTRACTION_FAILED` | 422 | Documento ilegible o fallo de visión | Toast de alerta y reintento en modal | "No se pudieron extraer los datos del RUT." | `curl -X POST -F "file=@corrupted.pdf" http://localhost:3000/organization/ai-engine/applications/rut_scanner/execute` | [x] |
