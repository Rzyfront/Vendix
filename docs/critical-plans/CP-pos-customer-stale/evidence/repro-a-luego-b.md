# Repro A-luego-B

1. Abrir POS con caja abierta. 2. Seleccionar cliente A existente. 3. Ir a crear cliente, diligenciar B. 4. Siguiente. 5. Pagar.

Esperado: orden/factura a B. Real pre-fix: a A por early-return resolveIfNeeded:390-393.
