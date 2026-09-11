# Escenario de Reproducción — Tienda en Riohacha

- **Ciudad del comercio y comprador:** Riohacha, La Guajira, Colombia.
- **Método de envío evaluado:** "Envío a domicilio" (renombrado desde "Entrega Rápida Local", tipo `own_fleet`).
- **Estado de Envío Nacional:** Desactivado (`is_active: false`).
- **Comportamiento en Checkout:**
  1. El comprador ingresa con producto físico al checkout.
  2. Pestaña activa: "Envío a domicilio".
  3. Dirección: Colombia, La Guajira, Riohacha.
  4. Cotización `POST /shipping/calculate?store_id=X`:
     - Si existe una zona con código postal (`440001`) o mayor especificidad que solo tiene pickup, `resolveZone` selecciona esa zona y descarta la zona de "Envío a domicilio".
     - `shippableOptions()` filtra `pickup`, quedando con 0 opciones a domicilio.
     - Se renderiza el estado vacío de cobertura: *"No hay cobertura de envío para esta dirección. La tienda todavía no despacha a la ciudad que elegiste. Prueba con otra dirección o elige 'Recoger en tienda'"*.
- **Solución certificada:**
  1. Resolución multi-zona: agrupa por método de envío. Para "Envío a domicilio" toma su tarifa configurada para Riohacha sin ser anulada por la tarifa de retiro.
  2. Prevalencia de ciudad: coincidencia en `Riohacha` valida la zona sin descartes colaterales.
