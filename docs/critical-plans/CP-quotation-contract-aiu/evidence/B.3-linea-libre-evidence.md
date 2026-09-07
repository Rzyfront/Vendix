# Evidencia B.3 — linea personalizada en cotizacion

Fecha: 2026-09-06. Ejecutor: orquestador.

- Modal: boton "+ Linea personalizada", fila con nombre/precio/IVA% editables
  solo cuando no hay producto; `recalculateItem` es matematica pura (sin
  producto) y el DTO ya omitia `product_id` ausente.
- Conversion: `convertToOrder` marca `item_type: 'custom'` cuando no hay
  producto (el DTO de orden lo admite); `order_items.product_id`,
  `invoice_items.product_id` y snapshot ya eran null-safe.
- Verificacion: specs dominio quotations PASS (22s) via runner del repo;
  ciclo ng serve OK sin errores cubriendo el arbol actual.
- Pendiente vivo (E.1): crear cotizacion con linea libre en UI, convertir a
  orden y a contrato, y emitir AIU verificando descripcion y base.
