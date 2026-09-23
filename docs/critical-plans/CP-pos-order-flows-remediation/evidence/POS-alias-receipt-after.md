# Alias persistido en confirmación POS

Tras `6f1b32cfa` + `29e3f8912`, Playwright vendió el producto físico QA 421 por $5000 con alias `QA alias tiquete 20260923`. POST POS HTTP **201**, orden #1130/pago #826; el JSON `data.order.customer_alias` coincidió con la BD y el modal/tiquete mostró **Cliente: QA alias tiquete 20260923**, no «Consumidor Final» (`POS-alias-receipt-after.png`). El producto no requería reserva de cita; captura y SQL adjuntos. Los tres tests frontend de alias, 100 backend payments y watch Angular pasaron.
