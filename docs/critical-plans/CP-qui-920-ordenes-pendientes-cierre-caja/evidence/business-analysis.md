# Business Analysis Brief — QUI-920

## Decisiones adoptadas para la ejecución

El usuario ordenó ejecutar este plan. Se adopta su recomendación técnica y se aplican estas reglas:

1. **Pendientes:** son órdenes de origen de la sesión cuyo estado operativo no es terminal (`finished`, `delivered`, `cancelled`, `refunded`) o cuyo `remaining_balance > 0`. Se devuelven motivos separados (`operational_pending`, `pending_collection`); saldos futuros nunca se agregan al efectivo de caja.
2. **Completado masivo:** todo o nada. Sólo órdenes con saldo cero, sin entrega ni preparación pendiente y con stock/flujo validado pueden usar el seam canónico de finalización. No se crea pago, entrega ni movimiento de caja. Una sola inelegible cancela el lote completo.
3. **COD entregado:** si conserva saldo, permanece en la alerta como `pending_collection`; no se finaliza de nuevo ni se suma a efectivo esperado.
4. **Cierre excepcional:** `pending_decision=override` requiere motivo no vacío y permiso existente `store:cash_registers:close_session`; no modifica órdenes. La caja guarda actor, hora, motivo, fingerprint y snapshot en `summary`.
5. **Legacy:** no inferir origen desde primer cobro, fecha ni cajero. Órdenes antiguas sin evidencia quedan `origin_cash_session_id=null`; sesiones existentes sin tracking muestran la advertencia de legacy no atribuido y requieren decisión explícita con motivo. Sesiones abiertas nuevas se crean con tracking activo.
6. **Atribución:** se fija únicamente al persistir una orden de POS bajo una sesión del mismo usuario y tienda que siga abierta, bajo lock transaccional compartido con cierre. Edición y cobro posterior conservan el origen. Ecommerce/QR público y pedidos sin sesión quedan null.

Estas reglas concretan las recomendaciones del plan bajo la instrucción de ejecución; no autorizan movimientos de dinero ficticios ni backfill heurístico.

## Confirmado por el ticket
- Avisar antes de cerrar caja si hay órdenes sin completar de la sesión/turno; contar, filtrar y permitir navegar a cada una.
- Ofrecer completado masivo y confirmación obligatoria para cerrar dejando pendientes.
- Mantener el cierre con órdenes abiertas como excepción explícita, si se elige «Continuar y cerrar caja».

## Hallazgos económicos
- `paid` no es estado de orden; hay saldo e historial de pagos independientes del estado.
- `finished` puede disparar inventario y costo. No representa cobro ni entrega ficticia.
- El efectivo esperado viene de movimientos, no de estados de orden.
- La caja del primer cobro y la caja donde se creó la orden pueden diferir.
- El bulk existente es por orden y parcialmente exitoso; contradice atomicidad del ticket.

## Recomendación del plan, pendiente de ratificación
- Alerta de dos motivos: trabajo operativo abierto y saldo aún pendiente; no sumar cobros futuros al arqueo.
- Finalizar en bloque solamente órdenes sin saldo, entrega ni cocina pendiente y con stock/flow validado; todo o nada si se mantiene aceptación de atomicidad.
- Cierre excepcional conserva órdenes y registra motivo, actor, snapshot y hora.
- Orden legacy sin atribución no se asigna por fecha/usuario; revisión explícita antes de activar el guard.

## Preguntas críticas
1. ¿«Completar todas» sólo finaliza órdenes elegibles o también pretende cobrar/entregar? Si lo segundo, el issue necesita datos de pago/entrega y otro flujo.
2. ¿Todo o nada real o éxito parcial por fila con reporte? El ticket exige lo primero, el bulk actual da lo segundo.
3. ¿Órdenes `delivered` con saldo COD cuentan como pendientes de cobro de ESTA caja o quedan en ruta/contraentrega?
4. ¿El cierre excepcional exige motivo y/o aprobación de supervisor? ¿Qué rol puede usarlo?
5. ¿Qué hacer con órdenes abiertas ya existentes sin sesión demostrable?
