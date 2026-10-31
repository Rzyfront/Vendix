# D.2 — Despliegue Gradual y Reconciliación

Fecha: 2026-10-14
Responsable: big-model (orquestador sopus)

## 1. Procedimiento de Activación por Tienda (Piloto Taller & Barbería)

Para activar estaciones de servicio en una tienda piloto:
1. **Auditoría de reservas futuras legadas (DB-20):**
   Ejecutar la consulta de verificación de citas activas futuras sin asignación:
   ```sql
   SELECT b.id, b.store_id, b.date, b.start_time, b.end_time, b.status
   FROM bookings b
   JOIN products p ON p.id = b.product_id
   WHERE b.store_id = :store_id
     AND b.status IN ('confirmed', 'pending')
     AND b.date >= CURRENT_DATE
     AND b.service_allocation_id IS NULL;
   ```
2. **Criterio de bloqueo:**
   Si existen reservas activas futuras sin `service_allocation_id`, se bloquea la activación del flag `requires_station` en los servicios de esa tienda hasta que el operador las reasigne manualmente a una estación o se concilien.

3. **Activación de flag por servicio:**
   Una vez verificado que no hay solapes ni citas huérfanas en el horizonte de agenda:
   ```sql
   UPDATE products
   SET requires_station = true, updated_at = NOW()
   WHERE id = :product_id AND store_id = :store_id;
   ```

## 2. Monitoreo y Sistema de Alertas

- **Fallo en entrega de enlace / email (DB-15):**
  Si el envío del enlace de progreso por correo falla, se registra en `service_contact_attempts` con status `'failed'` y se emite la notificación store-level `service_session_email_failed`.
- **Compensación y Reconciliación de Checkout (F-016):**
  Si durante el checkout atómico la reserva o asignación de stock falla tras confirmar la orden, se activa la compensación inmediata (`lockOrderLifecycle` + void/cancel) y se emite la alerta `checkout_reconciliation_required`.
- **Correlación de Consentimiento y Aplicación (F-014 / F-017):**
  La aprobación de propuestas de presupuesto por el cliente queda registrada en `service_proposal_decisions` con challenge/proof criptográfico y se aplica atómicamente a `orders` y `order_items` bajo aislamiento `Serializable`, incrementando `service_version`.

## 3. Procedimiento de Rollback Seguro (F-007)

Ante cualquier anomalía financiera o conflicto en producción:
1. **Ocultar UI y deshabilitar flags:**
   - Desactivar `requires_station = false` en los productos afectados.
2. **Mantener guards activos:**
   - No deshabilitar los guards de backend para evitar condiciones de carrera en sesiones ya abiertas.
3. **Drenar sesiones activas:**
   - Permitir que las sesiones actualmente en `open` o `in_progress` completen su ciclo natural hacia `completed` o `cancelled`.
4. **Revocación de tokens públicos:**
   - Si se detecta compromiso o error crítico de privacidad:
   ```sql
   UPDATE service_session_tokens
   SET revoked_at = NOW()
   WHERE store_id = :store_id AND revoked_at IS NULL;
   ```
