# Changelog

Todos los cambios notables de este proyecto se documentarán en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto se adhiere al [Versionado Semántico](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Añadido

- **Roles `mesero` y `cocina`**, con permisos mínimos y explícitos para operar el flujo de restaurante (servir mesas, disparar a cocina, cobrar / preparar y marcar tickets sin ver dinero) (40b7f91c3).
- **Vista de mesero mobile-first**: mesas con botones grandes (tap-targets), CTA fija de "Cerrar mesa" / "Cobrar" y diálogos accesibles para el flujo de mesa desde el teléfono (3edefcf2f).
- **Venta tri-estado en el POS**: anónima, con alias ("Venta con nombre o referencia") o con cliente registrado. El alias se imprime en la cabecera del tiquete, junto al número de orden (no se confunde con el bloque de datos del cliente) (823aa3dbb, db8b7568b, 3edefcf2f, e4f62d902).
- **Transferencia bancaria con múltiples cuentas**: el cajero o mesero elige la cuenta al cobrar por transferencia; administración de cuentas bancarias desde configuración de pagos (823aa3dbb, 2a6c518a8).
- **Auto-impresión del tiquete de despacho al confirmar en postventa**, opt-in vía el nuevo setting `print_dispatch_ticket_auto_on_postventa` (203d981c0, 39f11bf22).
- **Pantalla "Pagos sin asignar"** en conciliación bancaria, para localizar pagos recibidos que aún no calzan con una transacción bancaria (604e006df).
- **La variante del plato llega a cocina y al tiquete impreso.** Antes, si el cliente pedía "Pollo Picante", cocina y el tiquete solo mostraban "Pollo" (823aa3dbb, 19445c177, 9864af834).
- **Filtro de tres estados en el listado de productos**: Productos / Insumos / Todos (ver también la sección Cambiado) (bf34583ae).
- Accesibilidad base compartida en las nuevas superficies: `aria-live` para avisos dinámicos, `request_id` para trazabilidad de errores y respeto a *reduced motion* (9d46e8335).

### Cambiado

- **Panel de módulos (`panel_ui`):** entrar por URL directa a un módulo oculto ahora redirige al primer módulo activo del usuario en lugar de cargar el módulo completo — cierra un bypass de la visibilidad del panel. La misma redirección al primer módulo activo aplica cuando el panel principal está deshabilitado (eaad1a6be).
- **Listado de productos:** por defecto ya **no** muestra insumos; usa el nuevo filtro de tres estados para volver a verlos (bf34583ae).
- **Cocina (KDS) no muestra dinero en ninguna superficie**: ni precios, ni costos, ni ganancias, en tickets, recetas o turnos de estación. El resumen de costo de insumos por turno se **retiró sin sustituto** en cocina — el turno solo reporta cantidades por insumo (40b7f91c3, e4f62d902, b8714e33f, ade76d54a).
- **Migración de datos de alcance de plataforma:** el `custom_config` del método de pago `bank_transfer` pasa de una única cuenta en la raíz del objeto a `accounts[0].legacy` (todas las tiendas de todos los tenants que tengan `bank_transfer` activado). No se pierde el nombre del banco ni ningún otro dato: se reubica dentro de la nueva estructura de múltiples cuentas (2a6c518a8).
- Rendimiento del camino caliente de cocina (disparo de pedidos a cocina) mejorado, eliminando consultas redundantes por línea de pedido (adad98328).

### Corregido

- El ticket de cocina tomaba la sesión de mesa **más antigua** en lugar de la sesión abierta actual, lo que podía mostrar mesa/mesero equivocados en la comanda (2010aebde).
- Un rechazo por permisos insuficientes en el flujo del mesero llegaba al toast como `"Access denied"` en inglés en vez de un mensaje entendible (38436b5b1).
- El alias de venta rápida se aceptaba en el formulario pero se descartaba en silencio al crear la orden; ahora se persiste correctamente (e4f62d902).
- El toast de auto-impresión de tiquetes indicaba "enviado" aun cuando no se imprimía ningún documento (e4f62d902).
- Varios bloqueos encontrados en una auditoría adversarial del flujo completo del mesero: apertura de mesa, cobro y carga del catálogo de métodos de pago devolvían 403 en pasos intermedios de la implementación; también se corrigieron permisos residuales de `cocina` heredados de versiones intermedias del seed durante la épica, que permitían seguir leyendo el total de la cuenta de una mesa (e4f62d902, 8f513cc54, 22313ab79, ade76d54a).
- Endpoints de disparo de cocina y de partir cuenta devolvían HTTP 201 con `success:false` en vez del código de error real (19445c177).
- Validación agregada para evitar guardar o disparar a cocina un ítem cuya variante no corresponde al producto (19445c177, 9864af834).

### Seguridad

- **Cierre de un fail-open de severidad P0** en los endpoints de pagos (`payments.controller`): 10 de 11 operaciones que mueven dinero (cobrar, confirmar, listar, reembolsar) carecían de verificación de permisos y quedaban accesibles a cualquier usuario autenticado de la tienda. Se añadió el permiso correspondiente a cada operación (afda491a5).
- **Cierre de un fail-open equivalente y más severo** en los métodos de pago de la tienda (`store-payment-methods.controller`): la clase completa no tenía guard de autorización registrado, dejando sus 10 operaciones (incluida la edición de a qué cuenta bancaria llega el dinero) abiertas a cualquier usuario autenticado, incluyendo mesero y cocina (afda491a5).
- Se añadió verificación de propiedad al solicitar el reembolso de un pago: un cliente ya no puede reembolsar un pago que no le pertenece (afda491a5).
- Los rechazos de permisos ahora quedan registrados en el log de la aplicación; antes eran completamente invisibles, incluso en auditoría (afda491a5).
