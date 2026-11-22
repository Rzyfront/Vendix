-- Seed: initial skills ("how to do X in Vendix") for Vex, F4 T32.
--
-- What it does:
--   Inserts 10 published skills (version 1) into ai_agent_skills and their
--   immutable version-1 row into ai_agent_skill_versions. Bodies are Spanish
--   guides grounded in the existing screens and the registered Vex tools.
--   Skills are indexed for search by the application at boot (managed
--   documents, release_hash = 'managed'); this migration does not touch
--   ai_knowledge_documents.
--
-- DATA IMPACT:
--   Tables affected: ai_agent_skills (INSERT 10 rows), ai_agent_skill_versions
--   (INSERT 10 rows). 0 rows updated, 0 rows deleted. No other table is touched.
--   Idempotency: skills use ON CONFLICT (key) DO NOTHING, so a skill edited
--   later from superadmin is never overwritten by a re-run or a later deploy;
--   version rows are inserted only when (skill_id, version) 1 does not exist.
--   Reversibility: additive only; the rows can be archived from superadmin.
--   Depends on: 20261224100000 (creates both tables).

-- cierre-de-caja
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('cierre-de-caja', 'Cierre de caja', 'caja', $sk$# Cierre de caja

Para qué sirve: terminar el turno de una caja registradora, contar el efectivo (arqueo) y dejar registrada la diferencia entre lo esperado y lo contado.

## Dónde se hace
Menú **Caja Registradora** (/admin/cash-registers), sesión abierta de la caja, botón **Cerrar caja**.

## Antes de cerrar
- Confirma que hay una sesión abierta (herramienta get_active_cash_session). Sin sesión abierta no hay nada que cerrar.
- Revisa el reporte previo al cierre (get_cash_session_close_report): ventas en efectivo, otros medios de pago, retiros, ingresos y el efectivo esperado.
- Revisa los movimientos de la sesión (list_cash_session_movements). Si falta un retiro o un ingreso, regístralo antes con record_cash_movement.
- Cuenta el efectivo físico. El monto contado lo da la persona; nunca lo estimes. Cero es un valor válido.

## Pasos
1. Abre la sesión de la caja y pulsa Cerrar caja.
2. Escribe el efectivo contado en el arqueo y, si quieres, una nota del cierre.
3. Si el contado no coincide con lo esperado, revisa la causa (retiros sin registrar, propinas, cambio entregado) antes de confirmar.
4. Confirma. El cierre es irreversible: la sesión cerrada no se reabre y la diferencia (faltante o sobrante) queda registrada.

## Errores comunes
- «No hay sesión abierta»: la caja ya se cerró o nunca se abrió; consulta el historial de sesiones.
- Descuadre de arqueo: casi siempre es un movimiento de caja sin registrar. Revísalo antes de cerrar.
- Cobros pendientes: termina o cancela las ventas en curso antes del cierre.

## Cómo verificar
Después de cerrar, el reporte de cierre muestra el efectivo esperado, el contado y la diferencia.$sk$,
   ARRAY['get_active_cash_session', 'get_cash_session_close_report', 'list_cash_session_movements', 'record_cash_movement', 'close_cash_session']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Cierre de caja', 'caja', $sk$# Cierre de caja

Para qué sirve: terminar el turno de una caja registradora, contar el efectivo (arqueo) y dejar registrada la diferencia entre lo esperado y lo contado.

## Dónde se hace
Menú **Caja Registradora** (/admin/cash-registers), sesión abierta de la caja, botón **Cerrar caja**.

## Antes de cerrar
- Confirma que hay una sesión abierta (herramienta get_active_cash_session). Sin sesión abierta no hay nada que cerrar.
- Revisa el reporte previo al cierre (get_cash_session_close_report): ventas en efectivo, otros medios de pago, retiros, ingresos y el efectivo esperado.
- Revisa los movimientos de la sesión (list_cash_session_movements). Si falta un retiro o un ingreso, regístralo antes con record_cash_movement.
- Cuenta el efectivo físico. El monto contado lo da la persona; nunca lo estimes. Cero es un valor válido.

## Pasos
1. Abre la sesión de la caja y pulsa Cerrar caja.
2. Escribe el efectivo contado en el arqueo y, si quieres, una nota del cierre.
3. Si el contado no coincide con lo esperado, revisa la causa (retiros sin registrar, propinas, cambio entregado) antes de confirmar.
4. Confirma. El cierre es irreversible: la sesión cerrada no se reabre y la diferencia (faltante o sobrante) queda registrada.

## Errores comunes
- «No hay sesión abierta»: la caja ya se cerró o nunca se abrió; consulta el historial de sesiones.
- Descuadre de arqueo: casi siempre es un movimiento de caja sin registrar. Revísalo antes de cerrar.
- Cobros pendientes: termina o cancela las ventas en curso antes del cierre.

## Cómo verificar
Después de cerrar, el reporte de cierre muestra el efectivo esperado, el contado y la diferencia.$sk$,
   ARRAY['get_active_cash_session', 'get_cash_session_close_report', 'list_cash_session_movements', 'record_cash_movement', 'close_cash_session']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'cierre-de-caja'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- apertura-de-caja
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('apertura-de-caja', 'Apertura de caja', 'caja', $sk$# Apertura de caja

Para qué sirve: iniciar el turno de una caja registradora con su base inicial en efectivo para poder cobrar ventas.

## Dónde se hace
Menú **Caja Registradora** (/admin/cash-registers), botón **Abrir caja**. También se puede abrir desde el Punto de Venta cuando la tienda exige caja abierta para cobrar.

## Antes de abrir
- Verifica que la caja no tenga ya una sesión abierta (get_active_cash_session). Una caja solo admite una sesión abierta a la vez.
- Cuenta la base inicial que queda en el cajón (el cambio con el que arranca el turno).

## Pasos
1. Elige la caja registradora que vas a usar.
2. Escribe la base inicial en efectivo (cero o más).
3. Confirma la apertura (open_cash_session).
4. La sesión queda abierta a nombre de quien la abrió y ya se pueden registrar cobros.

## Errores comunes
- «Ya hay una sesión abierta para la caja»: ciérrala primero o usa la sesión existente.
- No se puede cobrar en el Punto de Venta: falta abrir la caja cuando la tienda lo exige.
- Base mal escrita: no se corrige editando; registra un movimiento de caja o cierra y abre de nuevo con el valor correcto.

## Cómo verificar
Consulta la sesión activa: debe mostrar la caja, la base inicial y la hora de apertura.$sk$,
   ARRAY['open_cash_session', 'get_active_cash_session', 'list_cash_sessions']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Apertura de caja', 'caja', $sk$# Apertura de caja

Para qué sirve: iniciar el turno de una caja registradora con su base inicial en efectivo para poder cobrar ventas.

## Dónde se hace
Menú **Caja Registradora** (/admin/cash-registers), botón **Abrir caja**. También se puede abrir desde el Punto de Venta cuando la tienda exige caja abierta para cobrar.

## Antes de abrir
- Verifica que la caja no tenga ya una sesión abierta (get_active_cash_session). Una caja solo admite una sesión abierta a la vez.
- Cuenta la base inicial que queda en el cajón (el cambio con el que arranca el turno).

## Pasos
1. Elige la caja registradora que vas a usar.
2. Escribe la base inicial en efectivo (cero o más).
3. Confirma la apertura (open_cash_session).
4. La sesión queda abierta a nombre de quien la abrió y ya se pueden registrar cobros.

## Errores comunes
- «Ya hay una sesión abierta para la caja»: ciérrala primero o usa la sesión existente.
- No se puede cobrar en el Punto de Venta: falta abrir la caja cuando la tienda lo exige.
- Base mal escrita: no se corrige editando; registra un movimiento de caja o cierra y abre de nuevo con el valor correcto.

## Cómo verificar
Consulta la sesión activa: debe mostrar la caja, la base inicial y la hora de apertura.$sk$,
   ARRAY['open_cash_session', 'get_active_cash_session', 'list_cash_sessions']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'apertura-de-caja'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- crear-producto
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('crear-producto', 'Crear un producto', 'productos', $sk$# Crear un producto

Para qué sirve: dar de alta un producto o servicio nuevo en el catálogo con su precio y, si aplica, sus existencias iniciales.

## Dónde se hace
Menú **Productos > Lista** (/admin/products), botón para crear producto.

## Antes de crear
- Busca primero si ya existe con otro nombre (find_product) para no duplicar el catálogo.
- Ten a la mano el nombre y el precio de venta sin impuestos. Son lo único obligatorio.
- Opcionales: costo, SKU, código de barras, categoría, marca e impuestos.

## Pasos
1. Abre Productos y pulsa Crear producto.
2. Escribe el nombre y el precio de venta sin impuestos.
3. Completa categoría, marca, costo y código de barras si los tienes.
4. Si el producto tiene existencias, indica la cantidad inicial y la bodega (consulta las bodegas con get_inventory_locations).
5. Guarda. Vex puede hacerlo con create_product; las existencias iniciales entran a la bodega por defecto.
6. Para cargar stock después usa un ajuste de inventario (create_stock_adjustment), no edites el producto.

## Errores comunes
- Producto duplicado: busca por nombre, SKU o código de barras antes de crear.
- Precio con impuestos: el precio que se escribe es sin impuestos; el sistema calcula el precio final.
- Stock que no aparece: la cantidad inicial va a la bodega por defecto; revisa la bodega elegida.

## Cómo verificar
Busca el producto por nombre: debe aparecer con su precio y sus existencias.$sk$,
   ARRAY['find_product', 'create_product', 'get_inventory_locations', 'create_stock_adjustment']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Crear un producto', 'productos', $sk$# Crear un producto

Para qué sirve: dar de alta un producto o servicio nuevo en el catálogo con su precio y, si aplica, sus existencias iniciales.

## Dónde se hace
Menú **Productos > Lista** (/admin/products), botón para crear producto.

## Antes de crear
- Busca primero si ya existe con otro nombre (find_product) para no duplicar el catálogo.
- Ten a la mano el nombre y el precio de venta sin impuestos. Son lo único obligatorio.
- Opcionales: costo, SKU, código de barras, categoría, marca e impuestos.

## Pasos
1. Abre Productos y pulsa Crear producto.
2. Escribe el nombre y el precio de venta sin impuestos.
3. Completa categoría, marca, costo y código de barras si los tienes.
4. Si el producto tiene existencias, indica la cantidad inicial y la bodega (consulta las bodegas con get_inventory_locations).
5. Guarda. Vex puede hacerlo con create_product; las existencias iniciales entran a la bodega por defecto.
6. Para cargar stock después usa un ajuste de inventario (create_stock_adjustment), no edites el producto.

## Errores comunes
- Producto duplicado: busca por nombre, SKU o código de barras antes de crear.
- Precio con impuestos: el precio que se escribe es sin impuestos; el sistema calcula el precio final.
- Stock que no aparece: la cantidad inicial va a la bodega por defecto; revisa la bodega elegida.

## Cómo verificar
Busca el producto por nombre: debe aparecer con su precio y sus existencias.$sk$,
   ARRAY['find_product', 'create_product', 'get_inventory_locations', 'create_stock_adjustment']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'crear-producto'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- ajuste-de-inventario
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('ajuste-de-inventario', 'Ajuste de inventario por conteo físico', 'inventario', $sk$# Ajuste de inventario por conteo físico

Para qué sirve: cuadrar las existencias del sistema con lo que hay físicamente en una bodega: conteo que no cuadra, mercancía dañada, perdida, robada o vencida.

## Dónde se hace
Menú **Inventario > Ajustes de Stock**.

## Antes de ajustar
- Identifica el producto (find_product) y la bodega (get_inventory_locations).
- Mira las existencias actuales (get_stock_levels) y los últimos movimientos (get_stock_movements) para entender de dónde viene la diferencia: una compra sin recibir, una venta sin descontar, una transferencia pendiente.
- Cuenta lo que hay en la bodega. El conteo lo da la persona.

## Pasos
1. Abre Ajustes de Stock y crea un ajuste nuevo.
2. Elige producto y bodega.
3. Escribe la cantidad FINAL que quedó en la bodega, no la diferencia.
4. Indica el motivo del ajuste (conteo, daño, pérdida, vencimiento).
5. Confirma. El ajuste deja traza de auditoría, recalcula el costo del inventario y genera el asiento contable (adjust_stock).

## Errores comunes
- Escribir la diferencia en vez del total: el sistema espera la cantidad final.
- Editar el producto para corregir existencias: nunca; el ajuste es la única forma correcta.
- Ajustar en la bodega equivocada: revisa los niveles por ubicación.

## Cómo verificar
Consulta de nuevo get_stock_levels: la cantidad debe ser la contada, y el movimiento aparece en el historial.$sk$,
   ARRAY['find_product', 'get_stock_levels', 'get_stock_movements', 'get_inventory_locations', 'adjust_stock']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Ajuste de inventario por conteo físico', 'inventario', $sk$# Ajuste de inventario por conteo físico

Para qué sirve: cuadrar las existencias del sistema con lo que hay físicamente en una bodega: conteo que no cuadra, mercancía dañada, perdida, robada o vencida.

## Dónde se hace
Menú **Inventario > Ajustes de Stock**.

## Antes de ajustar
- Identifica el producto (find_product) y la bodega (get_inventory_locations).
- Mira las existencias actuales (get_stock_levels) y los últimos movimientos (get_stock_movements) para entender de dónde viene la diferencia: una compra sin recibir, una venta sin descontar, una transferencia pendiente.
- Cuenta lo que hay en la bodega. El conteo lo da la persona.

## Pasos
1. Abre Ajustes de Stock y crea un ajuste nuevo.
2. Elige producto y bodega.
3. Escribe la cantidad FINAL que quedó en la bodega, no la diferencia.
4. Indica el motivo del ajuste (conteo, daño, pérdida, vencimiento).
5. Confirma. El ajuste deja traza de auditoría, recalcula el costo del inventario y genera el asiento contable (adjust_stock).

## Errores comunes
- Escribir la diferencia en vez del total: el sistema espera la cantidad final.
- Editar el producto para corregir existencias: nunca; el ajuste es la única forma correcta.
- Ajustar en la bodega equivocada: revisa los niveles por ubicación.

## Cómo verificar
Consulta de nuevo get_stock_levels: la cantidad debe ser la contada, y el movimiento aparece en el historial.$sk$,
   ARRAY['find_product', 'get_stock_levels', 'get_stock_movements', 'get_inventory_locations', 'adjust_stock']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'ajuste-de-inventario'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- orden-de-compra
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('orden-de-compra', 'Orden de compra a un proveedor', 'compras', $sk$# Orden de compra a un proveedor

Para qué sirve: pedirle mercancía a un proveedor, aprobar la orden y recibir lo que llega para que entre al inventario.

## Dónde se hace
Menú **Órdenes > Ordenes de Compra**.

## Antes de crear
- Verifica que el proveedor exista (find_supplier); si no, créalo en Inventario > Proveedores.
- Ten claros los productos, cantidades y costos por unidad (find_product).
- Define la bodega destino (get_inventory_locations).

## Pasos
1. Crea la orden con proveedor, bodega y líneas (manage_purchase_orders, acción create). Toda orden nace en borrador y se puede editar mientras siga así.
2. Revisa la orden (get_purchase_order): líneas, costos y totales.
3. Aprueba la orden cuando esté correcta.
4. Cuando llegue la mercancía, recibe contra la orden indicando la cantidad recibida de cada línea (approve_receive_purchase_order). Se admite recepción parcial.
5. La recepción mueve stock real y recalcula costos. El pago al proveedor es un paso aparte.

## Errores comunes
- Línea base sobre un producto con variantes: se rechaza; crea la orden con la variante.
- Querer corregir una orden ya aprobada: solo se edita en borrador; si no, se cancela y se crea otra.
- Recibir de más o de menos: la cantidad recibida debe ser la real que llegó.

## Cómo verificar
La orden pasa a recibida (o parcialmente recibida) y get_stock_levels refleja las nuevas existencias.$sk$,
   ARRAY['find_supplier', 'find_product', 'get_inventory_locations', 'manage_purchase_orders', 'get_purchase_order', 'approve_receive_purchase_order']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Orden de compra a un proveedor', 'compras', $sk$# Orden de compra a un proveedor

Para qué sirve: pedirle mercancía a un proveedor, aprobar la orden y recibir lo que llega para que entre al inventario.

## Dónde se hace
Menú **Órdenes > Ordenes de Compra**.

## Antes de crear
- Verifica que el proveedor exista (find_supplier); si no, créalo en Inventario > Proveedores.
- Ten claros los productos, cantidades y costos por unidad (find_product).
- Define la bodega destino (get_inventory_locations).

## Pasos
1. Crea la orden con proveedor, bodega y líneas (manage_purchase_orders, acción create). Toda orden nace en borrador y se puede editar mientras siga así.
2. Revisa la orden (get_purchase_order): líneas, costos y totales.
3. Aprueba la orden cuando esté correcta.
4. Cuando llegue la mercancía, recibe contra la orden indicando la cantidad recibida de cada línea (approve_receive_purchase_order). Se admite recepción parcial.
5. La recepción mueve stock real y recalcula costos. El pago al proveedor es un paso aparte.

## Errores comunes
- Línea base sobre un producto con variantes: se rechaza; crea la orden con la variante.
- Querer corregir una orden ya aprobada: solo se edita en borrador; si no, se cancela y se crea otra.
- Recibir de más o de menos: la cantidad recibida debe ser la real que llegó.

## Cómo verificar
La orden pasa a recibida (o parcialmente recibida) y get_stock_levels refleja las nuevas existencias.$sk$,
   ARRAY['find_supplier', 'find_product', 'get_inventory_locations', 'manage_purchase_orders', 'get_purchase_order', 'approve_receive_purchase_order']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'orden-de-compra'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- registrar-gasto
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('registrar-gasto', 'Registrar un gasto', 'gastos', $sk$# Registrar un gasto

Para qué sirve: dejar anotado un gasto del negocio (arriendo, servicios, transporte, compras menores) para que cuente en los reportes financieros.

## Dónde se hace
Menú **Finanzas > Gastos**, botón para crear gasto.

## Antes de registrar
- Ten el monto (mayor que cero), la fecha del gasto y una descripción.
- Si tienes la factura o el soporte, puedes subirlo y extraer los datos con inteligencia artificial (ai_extract_document) y revisarlos antes de guardar (validate_extraction).
- Elige la categoría del gasto si aplica.

## Pasos
1. Abre Gastos y pulsa Crear gasto.
2. Escribe el monto, la fecha (año-mes-día), la descripción y la categoría.
3. Guarda (create_expense). El gasto nace en estado pendiente.
4. Quien tenga permiso lo aprueba (approve_expense). La aprobación es un paso separado del registro.
5. Consulta el gasto con get_expense para ver su estado.

## Errores comunes
- Monto en cero o negativo: se rechaza.
- Gasto que no aparece en reportes: sigue pendiente; falta aprobarlo.
- Datos mal extraídos del documento: corrige la extracción antes de guardar.

## Cómo verificar
El gasto aparece en la lista de Gastos con el monto y estado correctos.$sk$,
   ARRAY['create_expense', 'get_expense', 'approve_expense', 'ai_extract_document', 'validate_extraction']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Registrar un gasto', 'gastos', $sk$# Registrar un gasto

Para qué sirve: dejar anotado un gasto del negocio (arriendo, servicios, transporte, compras menores) para que cuente en los reportes financieros.

## Dónde se hace
Menú **Finanzas > Gastos**, botón para crear gasto.

## Antes de registrar
- Ten el monto (mayor que cero), la fecha del gasto y una descripción.
- Si tienes la factura o el soporte, puedes subirlo y extraer los datos con inteligencia artificial (ai_extract_document) y revisarlos antes de guardar (validate_extraction).
- Elige la categoría del gasto si aplica.

## Pasos
1. Abre Gastos y pulsa Crear gasto.
2. Escribe el monto, la fecha (año-mes-día), la descripción y la categoría.
3. Guarda (create_expense). El gasto nace en estado pendiente.
4. Quien tenga permiso lo aprueba (approve_expense). La aprobación es un paso separado del registro.
5. Consulta el gasto con get_expense para ver su estado.

## Errores comunes
- Monto en cero o negativo: se rechaza.
- Gasto que no aparece en reportes: sigue pendiente; falta aprobarlo.
- Datos mal extraídos del documento: corrige la extracción antes de guardar.

## Cómo verificar
El gasto aparece en la lista de Gastos con el monto y estado correctos.$sk$,
   ARRAY['create_expense', 'get_expense', 'approve_expense', 'ai_extract_document', 'validate_extraction']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'registrar-gasto'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- crear-cliente
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('crear-cliente', 'Crear un cliente', 'clientes', $sk$# Crear un cliente

Para qué sirve: registrar a una persona o empresa que le compra a la tienda para facturarle, venderle a crédito o dar seguimiento comercial.

## Dónde se hace
Menú **Clientes > Todos los Clientes**, botón para crear cliente. También se puede crear desde el Punto de Venta al elegir cliente.

## Antes de crear
- Busca si ya existe por nombre, documento, correo o teléfono (lookup_customer) para evitar duplicados.
- Ten el documento de identidad (cédula o NIT) y un medio de contacto confirmados si el cliente va a recibir factura electrónica.

## Pasos
1. Abre Clientes y pulsa Crear cliente.
2. Escribe nombre y apellido, o razón social si es empresa.
3. Agrega tipo y número de documento, correo y teléfono.
4. Guarda (upsert_customer: crea o actualiza sin duplicar).
5. Verifica con una nueva búsqueda que el cliente quedó con su identificador real.

## Errores comunes
- Cliente duplicado: el documento o el correo ya existen; actualiza el existente.
- Factura electrónica rechazada por datos del cliente: documento o correo mal escritos.
- Correo vacío: se permite, pero no podrás enviarle la factura por correo.

## Cómo verificar
Busca al cliente por documento: debe aparecer una sola vez con sus datos.$sk$,
   ARRAY['lookup_customer', 'upsert_customer']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Crear un cliente', 'clientes', $sk$# Crear un cliente

Para qué sirve: registrar a una persona o empresa que le compra a la tienda para facturarle, venderle a crédito o dar seguimiento comercial.

## Dónde se hace
Menú **Clientes > Todos los Clientes**, botón para crear cliente. También se puede crear desde el Punto de Venta al elegir cliente.

## Antes de crear
- Busca si ya existe por nombre, documento, correo o teléfono (lookup_customer) para evitar duplicados.
- Ten el documento de identidad (cédula o NIT) y un medio de contacto confirmados si el cliente va a recibir factura electrónica.

## Pasos
1. Abre Clientes y pulsa Crear cliente.
2. Escribe nombre y apellido, o razón social si es empresa.
3. Agrega tipo y número de documento, correo y teléfono.
4. Guarda (upsert_customer: crea o actualiza sin duplicar).
5. Verifica con una nueva búsqueda que el cliente quedó con su identificador real.

## Errores comunes
- Cliente duplicado: el documento o el correo ya existen; actualiza el existente.
- Factura electrónica rechazada por datos del cliente: documento o correo mal escritos.
- Correo vacío: se permite, pero no podrás enviarle la factura por correo.

## Cómo verificar
Busca al cliente por documento: debe aparecer una sola vez con sus datos.$sk$,
   ARRAY['lookup_customer', 'upsert_customer']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'crear-cliente'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- emitir-factura-electronica
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('emitir-factura-electronica', 'Emitir una factura electrónica', 'facturacion', $sk$# Emitir una factura electrónica

Para qué sirve: convertir una venta en factura electrónica y transmitirla a la DIAN con su consecutivo.

## Dónde se hace
Menú **Finanzas > Facturación** (/admin/invoicing), o desde la orden de venta.

## Requisitos
- La facturación electrónica de la tienda debe estar activa y con datos fiscales completos (menú Finanzas > Activar facturación electrónica).
- Debe existir una resolución de numeración vigente con saldo (list_invoice_resolutions).
- La orden debe estar pagada o lista para facturar (get_order) y el cliente con documento válido.

## Pasos
1. Crea la factura desde la orden (create_invoice_from_order). Queda en borrador.
2. Valida la factura (validate_invoice): revisa cliente, líneas, impuestos y totales.
3. Revisa que sea emisible (get_emit_readiness) y que la DIAN responda (get_dian_status).
4. Emite (send_invoice_dian). Es irreversible: transmite a la DIAN y gasta el consecutivo.
5. Consulta el estado fiscal real (get_invoice_status): aceptada, rechazada o pendiente.

## Errores comunes
- Resolución sin saldo o vencida: solicita una nueva o actívala antes de emitir.
- Factura rechazada: corrige el motivo que indica la DIAN y reenvía.
- Datos del cliente incompletos: actualiza documento y correo antes de validar.
- Una factura emitida no se borra; se corrige con nota crédito.

## Cómo verificar
get_invoice_status muestra la factura aceptada con su número y CUFE.$sk$,
   ARRAY['get_order', 'list_invoice_resolutions', 'create_invoice_from_order', 'validate_invoice', 'get_emit_readiness', 'get_dian_status', 'send_invoice_dian', 'get_invoice_status']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Emitir una factura electrónica', 'facturacion', $sk$# Emitir una factura electrónica

Para qué sirve: convertir una venta en factura electrónica y transmitirla a la DIAN con su consecutivo.

## Dónde se hace
Menú **Finanzas > Facturación** (/admin/invoicing), o desde la orden de venta.

## Requisitos
- La facturación electrónica de la tienda debe estar activa y con datos fiscales completos (menú Finanzas > Activar facturación electrónica).
- Debe existir una resolución de numeración vigente con saldo (list_invoice_resolutions).
- La orden debe estar pagada o lista para facturar (get_order) y el cliente con documento válido.

## Pasos
1. Crea la factura desde la orden (create_invoice_from_order). Queda en borrador.
2. Valida la factura (validate_invoice): revisa cliente, líneas, impuestos y totales.
3. Revisa que sea emisible (get_emit_readiness) y que la DIAN responda (get_dian_status).
4. Emite (send_invoice_dian). Es irreversible: transmite a la DIAN y gasta el consecutivo.
5. Consulta el estado fiscal real (get_invoice_status): aceptada, rechazada o pendiente.

## Errores comunes
- Resolución sin saldo o vencida: solicita una nueva o actívala antes de emitir.
- Factura rechazada: corrige el motivo que indica la DIAN y reenvía.
- Datos del cliente incompletos: actualiza documento y correo antes de validar.
- Una factura emitida no se borra; se corrige con nota crédito.

## Cómo verificar
get_invoice_status muestra la factura aceptada con su número y CUFE.$sk$,
   ARRAY['get_order', 'list_invoice_resolutions', 'create_invoice_from_order', 'validate_invoice', 'get_emit_readiness', 'get_dian_status', 'send_invoice_dian', 'get_invoice_status']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'emitir-factura-electronica'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- cobrar-venta-pos
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('cobrar-venta-pos', 'Cobrar una venta en el Punto de Venta', 'ventas', $sk$# Cobrar una venta en el Punto de Venta

Para qué sirve: registrar una venta de mostrador, recibir el pago y descontar el inventario.

## Dónde se hace
Menú **Punto de Venta** (/admin/pos).

## Antes de cobrar
- Confirma que hay caja abierta (get_cash_session_status) cuando la tienda lo exige; si no, abre la caja primero.
- Revisa que haya existencias del producto (check_stock_availability). Sin disponible, el cobro se bloquea salvo que la tienda permita sobreventa.

## Pasos
1. Abre el Punto de Venta y agrega productos al carrito (también por código de barras).
2. Elige el cliente si la venta lo requiere (obligatorio para facturar o vender a crédito).
3. Ajusta cantidades, descuentos y precios (manage_order_items).
4. Pulsa Cobrar y elige el medio de pago: efectivo, tarjeta, transferencia, etc.
5. Confirma el pago (pay_order). La orden pasa a procesando y se registra el pago en la caja.
6. Imprime o envía el recibo; si hace falta, factura la venta.

## Errores comunes
- «No hay caja abierta»: abre una sesión de caja.
- Cobro bloqueado por stock: ajusta el inventario o recibe la compra pendiente.
- Pago duplicado por doble clic: verifica con get_order antes de cobrar de nuevo.

## Cómo verificar
get_order muestra la orden pagada, con saldo cero y el método de pago registrado.$sk$,
   ARRAY['check_stock_availability', 'create_order', 'get_order', 'manage_order_items', 'pay_order', 'get_cash_session_status']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Cobrar una venta en el Punto de Venta', 'ventas', $sk$# Cobrar una venta en el Punto de Venta

Para qué sirve: registrar una venta de mostrador, recibir el pago y descontar el inventario.

## Dónde se hace
Menú **Punto de Venta** (/admin/pos).

## Antes de cobrar
- Confirma que hay caja abierta (get_cash_session_status) cuando la tienda lo exige; si no, abre la caja primero.
- Revisa que haya existencias del producto (check_stock_availability). Sin disponible, el cobro se bloquea salvo que la tienda permita sobreventa.

## Pasos
1. Abre el Punto de Venta y agrega productos al carrito (también por código de barras).
2. Elige el cliente si la venta lo requiere (obligatorio para facturar o vender a crédito).
3. Ajusta cantidades, descuentos y precios (manage_order_items).
4. Pulsa Cobrar y elige el medio de pago: efectivo, tarjeta, transferencia, etc.
5. Confirma el pago (pay_order). La orden pasa a procesando y se registra el pago en la caja.
6. Imprime o envía el recibo; si hace falta, factura la venta.

## Errores comunes
- «No hay caja abierta»: abre una sesión de caja.
- Cobro bloqueado por stock: ajusta el inventario o recibe la compra pendiente.
- Pago duplicado por doble clic: verifica con get_order antes de cobrar de nuevo.

## Cómo verificar
get_order muestra la orden pagada, con saldo cero y el método de pago registrado.$sk$,
   ARRAY['check_stock_availability', 'create_order', 'get_order', 'manage_order_items', 'pay_order', 'get_cash_session_status']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'cobrar-venta-pos'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

-- memoria-de-la-tienda-vex
INSERT INTO ai_agent_skills
  (key, title, module, body, candidate_tools, agent_keys, status, version, published_version, published_at, created_at, updated_at)
VALUES
  ('memoria-de-la-tienda-vex', 'Memoria de la tienda de Vex', 'ia', $sk$# Memoria de la tienda de Vex

Para qué sirve: que Vex recuerde preferencias y datos fijos de la tienda en todas las conversaciones (por ejemplo: «los cierres de caja se hacen a las 9 pm», «la bodega principal es Centro»).

## Dónde se hace
Menú **Configuración > Agentes IA** (/admin/settings/ai-agents), sección **Memoria**. Allí se ve, edita y borra cada recuerdo. También desde la conversación con Vex en /admin/vex: pídele «recuerda que…» u «olvida lo de…».

## Qué guarda
- Preferencias de trabajo y datos de la tienda (herramienta remember).
- Cada recuerdo es corto. La memoria tiene un tope de 40 recuerdos y 2000 caracteres en total.
- No guarda contraseñas, datos de pago ni documentos de identidad.

## Pasos
1. Dile a Vex qué recordar, o abre la sección Memoria y crea un recuerdo manual.
2. Revisa la lista: cada recuerdo muestra su origen (agente o manual) y quién lo modificó.
3. Edita el texto de un recuerdo si cambió el dato, o bórralo (herramienta forget). Para borrar todo, usa la opción de vaciar la memoria.

## Errores comunes
- «La memoria llegó a su tope»: edita o borra un recuerdo antes de agregar otro.
- Contenido rechazado por sensible: no incluyas claves ni datos de pago.
- Vex sigue usando un dato viejo: edita o borra el recuerdo desactualizado.

## Cómo verificar
Abre una conversación nueva con Vex y pregúntale por el dato: debe responder con lo guardado.$sk$,
   ARRAY['remember', 'forget']::text[], ARRAY['vex']::text[], 'published', 1, 1, NOW(), NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_agent_skill_versions
  (skill_id, version, title, module, body, candidate_tools, agent_keys, change_note, author_user_id, created_at)
SELECT s.id, 1, 'Memoria de la tienda de Vex', 'ia', $sk$# Memoria de la tienda de Vex

Para qué sirve: que Vex recuerde preferencias y datos fijos de la tienda en todas las conversaciones (por ejemplo: «los cierres de caja se hacen a las 9 pm», «la bodega principal es Centro»).

## Dónde se hace
Menú **Configuración > Agentes IA** (/admin/settings/ai-agents), sección **Memoria**. Allí se ve, edita y borra cada recuerdo. También desde la conversación con Vex en /admin/vex: pídele «recuerda que…» u «olvida lo de…».

## Qué guarda
- Preferencias de trabajo y datos de la tienda (herramienta remember).
- Cada recuerdo es corto. La memoria tiene un tope de 40 recuerdos y 2000 caracteres en total.
- No guarda contraseñas, datos de pago ni documentos de identidad.

## Pasos
1. Dile a Vex qué recordar, o abre la sección Memoria y crea un recuerdo manual.
2. Revisa la lista: cada recuerdo muestra su origen (agente o manual) y quién lo modificó.
3. Edita el texto de un recuerdo si cambió el dato, o bórralo (herramienta forget). Para borrar todo, usa la opción de vaciar la memoria.

## Errores comunes
- «La memoria llegó a su tope»: edita o borra un recuerdo antes de agregar otro.
- Contenido rechazado por sensible: no incluyas claves ni datos de pago.
- Vex sigue usando un dato viejo: edita o borra el recuerdo desactualizado.

## Cómo verificar
Abre una conversación nueva con Vex y pregúntale por el dato: debe responder con lo guardado.$sk$,
   ARRAY['remember', 'forget']::text[], ARRAY['vex']::text[], 'Versión inicial (semilla)', NULL, NOW()
FROM ai_agent_skills s
WHERE s.key = 'memoria-de-la-tienda-vex'
  AND NOT EXISTS (
    SELECT 1 FROM ai_agent_skill_versions v WHERE v.skill_id = s.id AND v.version = 1
  );

