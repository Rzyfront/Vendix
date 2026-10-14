# Business Analysis Brief

## Confirmado por el usuario
- Las estaciones se vinculan con servicios y proveedores; un proveedor puede ofrecer varios servicios y se selecciona qué estación usa.
- Una estación abierta recoge datos del cliente y del objeto atendido cuando aplique; barbería no exige vehículo.
- Cada estación tiene QR y el cliente recibe por correo un QR/enlace para consultar progreso en tienda en línea en tiempo real.
- El cliente comunica un límite de presupuesto; si una adición lo supera, se le contacta antes de permitirla.
- Una estación reservada u ocupada no debe ofrecerse como libre para el mismo intervalo.

## Supuestos de diseño, aún no confirmados
- Estación es recurso físico por tienda compartible entre proveedores compatibles; capacidad inicial 1.
- Presupuesto limita total final cobrable de la orden y la propuesta adicional espera aprobación explícita, vinculada a versión e importe.
- QR físico sólo identifica estación; el seguimiento usa token privado de sesión enviado por correo.
- El seguimiento muestra hitos y cargos autorizados, nunca notas internas, costos ni datos de terceros.

## Preguntas que bloquean ejecución económica
- ¿La estación se comparte entre proveedores o queda fija al empleado? ¿Puede tener capacidad mayor a 1?
- ¿El límite incluye servicio inicial, impuestos, descuentos, propinas y anticipo? ¿Se permite cotización mayor sin compromiso de cargo?
- ¿Qué prueba de consentimiento acepta el negocio: acción del cliente en enlace privado, código por correo/SMS o registro manual de llamada?
- ¿El botón contactar debe enviar correo/SMS/WhatsApp automáticamente o abrir llamada/mensaje para el personal? ¿Qué ocurre sin email o teléfono?
- ¿El QR también debe permitir pagar y autenticarse como comprador o sólo seguimiento/aprobación?
- ¿Cuánto dura el enlace y cuánto tiempo se conservan eventos y datos del vehículo/persona?

## Casos económicos mínimos
- Al crear orden con tope, validar el total inicial y registrar moneda/versión del presupuesto.
- Agregar llanta o servicio que excede el tope crea propuesta pendiente; la línea no llega a cobro, stock ni contabilidad antes de consentimiento.
- Aprobación de propuesta vieja, cancelada, alterada o de otra tienda no autoriza un cargo nuevo.
- Rechazo o silencio mantiene el límite y permite cerrar con trabajo autorizado.
- Si checkout o POS no puede garantizar estación, no presentar al cliente una compra confirmada con cita inexistente.

## Decisiones de diseño recomendadas para revisar
- En un taller, mostrar cliente y vehículo por separado; en barbería, cliente y servicio, sin campo vehículo. Los nombres y campos se configuran por tipo de servicio.
- La propuesta de adicional muestra base, ítems, cantidades, impuestos/descuentos, incremento, total nuevo, presupuesto vigente, moneda y vencimiento.
- Si el cliente rechaza o no responde, el trabajo adicional se detiene; el trabajo ya autorizado puede cerrarse.
- Sin correo o con envío fallido, personal verifica identidad y reemite enlace por canal autorizado; la decisión queda auditada.
- Pausa/no-show/cambio de proveedor, duración vencida y llegada tarde necesitan transición y regla de liberación explícitas.
