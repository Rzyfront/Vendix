# E.6-SA2 — Carril mesa: verificación por-código (justificada)

Fecha: 2026-09-23. Verificador: E6 three-lane curl verifier (SA2).

## Decisión: por-código, no por-curl

Existen sesiones abiertas en tienda 10 (p. ej. `table_sessions.id=128 → order 1197`,
`103 → 1105`, `96 → 1084`), pero pertenecen a fixtures de otros pasos (A2/A3 usan
mesas de la tienda 10). Cobrar/cerrar una por API para este check corrompería su
evidencia. Montar un fixture propio completo (mesa + sesión + orden + líneas) es el
caso "complejo" que la orden SA2 permite no forzar. Se verifica por lectura directa
del llamador de mesa contra los dos carriles ya probados por curl.

## Lectura: los tres llamadores son idénticos en regla, base y redondeo

Utilidad única: `apps/backend/src/common/utils/tip.util.ts:49` (`resolveTip(input,
grossProductsBase, round)` — porcentaje sobre bruto de productos, resuelto a monto
`fixed`).

| Carril | Base bruta | Llamada a `resolveTip` | Redondeo |
|---|---|---|---|
| Mesa (`payments.service.ts`) | `:3831` `newSubtotalGross = roundMoney(newSubtotal + newTax)` | `:3836-3838` `resolveTip(dto, newSubtotalGross, (v) => this.roundMoney(v))` | `:2380-2382` `roundMoney` |
| Retail (`payments.service.ts`) | `:4576-4578` `calculatedSubtotalGross = roundMoney(calculatedSubtotal + calculatedTaxAmount)` | `:4605-4607` `resolveTip(dto, calculatedSubtotalGross, (v) => this.roundMoney(v))` | mismo `roundMoney` |
| flow/pay (`order-flow.service.ts`) | `:1202-1204` `grossProductsBase = roundTipMoney(subtotal + tax)` | `:1205-1209` `resolveTip(dto, grossProductsBase, roundTipMoney)` | `:1197-1198` `roundTipMoney` = `Math.round((v + EPSILON) * 100) / 100`, fórmula idéntica a `roundMoney` |

- Ninguno incluye envío, descuento ni propina previa en la base (ADR-11).
- Los tres persisten la propina resuelta a monto fijo fuera de `subtotal_amount` y
  `tax_amount`, sumando a `grand_total`.
- No queda reimplementación en línea en retail (E.6 la retiró; ver
  `evidence/E6-tip-base-code-20260923.md`, Jest 249/249).

## Conclusión

El carril mesa ejecuta literalmente la misma función con la misma base y el mismo
redondeo que los dos carriles verificados por curl en este SA (retail: orden 1199,
propina 2000 sobre base 20000; flow/pay: orden 1200, propina 2000 sobre base
20000 — ver `E.6-SA2-tip-retail.json` y `E.6-SA2-tip-flowpay.json`). Con entradas
idénticas el resultado es idéntico por construcción: **coinciden sí**.

Cifra ADR-11 por proporcionalidad: base 20000 → propina 2000 es 10 % exacto, igual
que 11900 sobre 119000. (Producto 317 sin asignación de impuesto → tax 0 en ambos
carriles curl; el caso con IVA 19 % está fijado por la tabla Jest de E.6.)
