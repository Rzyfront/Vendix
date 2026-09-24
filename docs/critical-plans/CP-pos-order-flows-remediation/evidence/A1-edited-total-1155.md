# A.1 — editar líneas de borrador adoptado y cobrar total actualizado

Playwright standalone local, tienda #10, 2026-09-23. Borrador `home_delivery` #1155 / `POS-2026-0341` creado desde POS UI con producto #302 taxless, una línea de $38.000, cliente #197, método #9 y dirección #489.

- Reabrir en `/admin/pos?editOrder=1155` restauró la línea. Click real de producto #302 en catálogo → `PUT /store/orders/1155/items` **200**, dos líneas de $38.000; carrito mostró subtotal $76.000/IVA $0. La primera carga del checkout sufrió un retraso de hidratación sin escritura; se reintentó una vez después de comprobar que la orden seguía `draft` y sin pago.
- Checkout con envío → «Actualizar» hizo `PUT /store/orders/1155/editor` **200** con ambas líneas; «Finalizar venta» hizo `POST /store/payments/pos` **201**. Pantalla de éxito: `A1-edited-total-1155.png`.
- SQL: **misma** orden #1155 `processing`, `grand_total=76000.00`, `total_paid=76000.00`; pago #838 `succeeded` $76.000 asociado a #1155; dos `order_items` por $76.000. Ninguna cancelación automática posterior.

Cubre el cambio real del contenido y total del borrador que el recorrido #1153 no había ejercitado. No sanea los sobrepagos históricos de DB-02/DB-14.
