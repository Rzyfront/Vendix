# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `ORD_SHIP_NO_ZONE_001` | 200 (options:[]) | Ninguna zona o tarifa aplicable a la dirección | Muestra banner de cobertura vacía | "No hay cobertura de envío para esta dirección" | Simular dirección fuera de cobertura | [ ] |
| ERR-02 | `ORD_SHIP_CITY_UNRESOLVED_001` | 400 (frontend guard) | Ciudad o departamento no resoluble en catálogo | Bloquea avance a pago y muestra toast | "No se pudo determinar la ciudad de envío" | Enviar form con ciudad no mapeada | [ ] |
| ERR-03 | `SHIP_FIND_001` | 404 | Zona o método no encontrado al consultar | Muestra toast de error en modal admin | "El recurso de envío no existe" | Consultar ID inexistente en API | [ ] |
