# Evidencia — zonas y tarifas tienda 10 (DB local, solo lectura, 2026-09-08)

## shipping_zones (store_id=10)

| id | name | activa | countries | regions | cities | zip_codes |
|----|------|--------|-----------|---------|--------|-----------|
| 3 | Riohacha | sí | {CO} | 32 dptos incl. "La Guajira" | {} | {} |
| 4 | Entrega a Domicilio | sí | {CO} | 32 dptos incl. "La Guajira" | {} | {} |
| 5 | Riohacha | sí | {CO} | {"La Guajira"} | {Riohacha} | {440001} |

## shipping_rates (zonas 3,4,5, todas activas, métodos activos)

| id | zona | tipo | base | min | max | método |
|----|------|------|------|-----|-----|--------|
| 3 | 3 | free | 0 | null | null | Test Flota propia (own_fleet) |
| 5 | 3 | free | 0 | null | null | Test Personalizado (custom) |
| 4 | 4 | free | 0 | null | null | Test Flota propia (own_fleet) |
| 6 | 4 | free | 0 | null | null | Test Personalizado (custom) |
| 7 | 5 | free | 0 | null | null | Recoger En Tienda (pickup) |

## Lectura forense

La zona 5 (La Guajira/Riohacha/440001, score 1111) gana a las zonas 3/4 (score 11) para el payload anotado, pero solo contiene la tarifa 7 (pickup). Por eso la respuesta es `[pickup, zone_id:5, is_fallback:false]` y el domicilio queda sin opciones. Las tarifas domicilio existen pero viven en las zonas amplias que pierden el concurso de especificidad. Acción: agregar tarifas domicilio a la zona 5 (dato del comerciante, cero código).
