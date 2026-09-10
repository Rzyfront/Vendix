# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `PROD_TAXMAP_001` | 400 | `tax_inclusive_map` con forma inválida (valor no booleano) o catId fuera de `tax_category_ids` de la petición | Toast de error, no guarda, conserva el formulario | "El mapa de impuestos incluidos contiene valores inválidos" | `curl POST` con mapa inválido → 400 + código | [ ] |
| ERR-02 | `PROD_VALIDATE_001` | 422 | bulk `tax_category_action.ids` con categoría inexistente o de otra tienda (existe, no regresión) | Panel masivo marca lote fallido, resto continúa | "Una o más categorías de impuestos seleccionadas no existen..." | spec existente bulk-edit en verde | [ ] |
| ERR-03 | (sin código, invariante) | 200 | tasa ausente o 0% en categoría asignada | Precio sin impuesto, sin 500 | — | spec: asignación sin tasas → `total_tax_amount 0`, total == precio | [ ] |
