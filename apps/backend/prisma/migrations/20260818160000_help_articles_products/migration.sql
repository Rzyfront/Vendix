-- =====================================================
-- help_articles: dominio Productos (editar, precios, multi-tarifa, unidades,
-- variantes, impuestos, presentaciones en tienda en línea)
-- =====================================================
-- DATA IMPACT:
-- - Tablas afectadas: help_article_categories (SOLO INSERT, 1 fila condicional),
--   help_articles (SOLO INSERT, hasta 8 filas).
-- - Cambios de filas esperados:
--     * help_article_categories: 1 INSERT si no existe slug='producto'.
--       En producción ya existe (id 16) → 0 filas. En dev/local → 1 fila.
--     * help_articles: hasta 8 INSERT (los 8 slugs listados abajo).
--       0 UPDATE, 0 DELETE. Re-ejecución → 0 filas nuevas.
-- - Operaciones destructivas: NINGUNA.
--   Sin TRUNCATE / DROP / DELETE / UPDATE / ALTER.
-- - FK/cascade risk: ninguno. Solo INSERT.
--     help_articles.category_id -> help_article_categories.id (resuelto por
--     subconsulta sobre `slug`, NO por id literal: los ids de prod y dev
--     divergen — prod tiene 23 categorías, dev tiene 6).
--     help_articles.created_by_id -> users.id se deja en NULL (la FK es
--     onDelete: SetNull, y estos artículos son de plataforma, no de una persona).
-- - Idempotencia: ON CONFLICT (slug) DO NOTHING en ambas tablas. `slug` es
--   @unique en las dos. Un artículo que el equipo edite a mano después NUNCA
--   se pisa al reejecutar.
-- - Por qué migración y no seed: `prisma/seeds/help-articles.seed.ts` no está
--   enganchado al runner y los seeds no corren en producción; `migrate deploy`
--   sí. Precedentes: 20260704120000_seed_puc_iva_subaccounts,
--   20260427000000_platform_settings_seed_core.
-- - Motivo: el centro de ayuda ES la base de conocimiento de Vexi (RAG está
--   apagado para el asistente y EMBEDDABLE_ENTITY_TYPES excluye los artículos
--   a propósito). Producción no tenía UN SOLO artículo publicado sobre editar
--   un producto, multi-tarifa, precios/costo/margen, unidades de medida o
--   impuestos; el único de variantes está ARCHIVED y `search` filtra
--   status='PUBLISHED'. Sin estos artículos Vexi responde de memoria.
-- - Approval: plan aprobado y documentado en chat (Fase 2).
-- =====================================================

BEGIN;

-- Categoría destino. En producción ya existe (id 16, "Producto "); esto solo
-- cubre dev/local y cualquier entorno nuevo, para que la subconsulta por slug
-- de abajo siempre resuelva.
INSERT INTO help_article_categories (name, slug, description, icon, sort_order, is_active)
VALUES (
  'Producto',
  'producto',
  'Crear, editar y configurar productos: precios, tarifas, unidades, impuestos y variantes.',
  'package',
  30,
  TRUE
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------
-- 1. Cómo editar un producto
-- ---------------------------------------------------------------
INSERT INTO help_articles (title, slug, summary, content, type, status, category_id, module, tags, is_featured, sort_order, created_by_id)
SELECT
  'Cómo editar un producto',
  'como-editar-un-producto',
  'Recorrido completo del editor de un producto: datos básicos, precios y tarifas, inventario, unidades de medida, impuestos, categorías, marca y variantes.',
  $md$## Cómo editar un producto

Editar un producto es el mismo formulario que usaste al crearlo, con la información ya cargada. Todo lo que ves aquí se guarda de una sola vez cuando pulsas **Guardar**.

### 1. Abre el producto

Ve a **Productos** en el menú izquierdo, busca el producto por nombre, SKU o código de barras, y haz clic sobre él. También puedes usar el menú de la fila y elegir **Editar**.

### 2. Datos básicos

- **Nombre del producto**: es lo que ve el cliente en el POS y en la tienda en línea.
- **SKU**: tu código interno. Debe ser único en la tienda.
- **Código de barras**: el que trae el empaque. Si lo escaneas en el POS, el producto entra directo al carrito.
- **Marca** y **Categorías**: sirven para filtrar, para los reportes y para organizar la tienda en línea. Si la marca o la categoría no existe todavía, puedes crearla ahí mismo sin salir del formulario.

### 3. Precios y Tarifas

Aquí vive todo lo relacionado con dinero:

- **Costo**, **Margen (%)** y **Precio Venta** están enlazados: al mover uno, los otros se recalculan.
- **Precio de Oferta**: se activa con el interruptor **Activar precio de oferta** y reemplaza al precio normal mientras esté encendido.
- **Activar precios multi-tarifa**: abre el bloque de presentaciones de venta (bulto, caja, six-pack) y de tarifas por tipo de cliente.

Cada tema tiene su propio artículo; búscalos por *precios*, *margen* o *multi-tarifa*.

### 4. Inventario

- **Controlar inventario**: si está apagado, el producto se vende sin descontar existencias (útil para servicios).
- **Stock (unidad mínima)**: la cantidad actual. En productos que ya tienen movimientos, lo correcto es corregir el stock con un **ajuste de inventario**, no escribiendo el número aquí.
- **Peso (kg)**: se usa para calcular envíos.

### 5. Unidades de medida

Define en qué unidad **compras** y en qué unidad **cuentas el inventario**, y el factor entre las dos. El formulario te muestra la equivalencia calculada: *1 Bulto = 25 Kilogramos*.

### 6. Impuestos

En **Impuestos Aplicables** eliges los impuestos que lleva este producto. Si tu tienda muestra precios con impuesto incluido, el precio final se recalcula solo.

### 7. Variantes

Si el producto se vende en tallas, colores o sabores, actívalo en **Este producto tiene variantes**. Ojo: **un producto tiene variantes o presentaciones de venta, nunca las dos cosas**.

### 8. Guardar

Pulsa **Guardar**. Si falta algo obligatorio, el formulario te lleva directo al campo con el problema.

> Los cambios de precio aplican a las ventas nuevas. Las órdenes ya emitidas conservan el precio con el que se hicieron.$md$,
  'GUIDE'::help_article_type_enum,
  'PUBLISHED'::help_article_status_enum,
  (SELECT id FROM help_article_categories WHERE slug = 'producto'),
  'Productos',
  ARRAY['producto', 'editar', 'catalogo', 'precio', 'inventario'],
  TRUE,
  10,
  NULL
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------
-- 2. Precios de un producto: costo, margen y precio de venta
-- ---------------------------------------------------------------
INSERT INTO help_articles (title, slug, summary, content, type, status, category_id, module, tags, is_featured, sort_order, created_by_id)
SELECT
  'Precios de un producto: costo, margen y precio de venta',
  'precios-de-un-producto-costo-margen-y-precio-de-venta',
  'Cuál campo manda y cuál se calcula solo entre costo, margen, precio de venta y precio de oferta, y cómo se ve el precio final con impuestos.',
  $md$## Precios de un producto

En **Precios y Tarifas** hay cuatro números y conviene saber cuál manda sobre cuál.

### El costo

**Costo** es lo que a ti te cuesta el producto. No es un precio: es la base para calcular la ganancia y es lo que alimenta los reportes de rentabilidad y el costo de ventas.

Si compras el producto con órdenes de compra, el sistema mantiene el costo promedio por su cuenta a medida que recibes mercancía. El campo del formulario es el punto de partida.

### El margen y el precio de venta

**Margen (%)** y **Precio Venta** están enlazados con el costo:

- Si escribes el **margen**, el precio de venta se calcula.
- Si escribes el **precio de venta**, el margen se calcula.

O sea: el último que tocas es el que manda. Un margen de 30% sobre un costo de $10.000 da un precio de $14.286 — el margen se calcula sobre el precio, no sobre el costo.

### El precio de oferta

**Activar precio de oferta** enciende un precio temporal que reemplaza al normal en el POS y en la tienda en línea mientras esté activo. El precio normal no se pierde: al apagar el interruptor vuelve tal cual.

Úsalo para promociones. No lo uses para bajar el precio de forma permanente: para eso cambia el precio de venta.

### El precio final

Debajo verás **Precio Final**. Es lo que realmente paga el cliente, ya con los impuestos aplicados según la configuración de tu tienda:

- Si tu tienda maneja **precios con impuesto incluido**, el precio de venta ya trae el impuesto adentro y el precio final es igual.
- Si maneja **precios sin impuesto**, el impuesto se suma encima y el precio final es mayor.

### Precio editable en el POS

**Precio editable en POS** permite que quien vende cambie el precio en el momento. Déjalo apagado si no quieres que se negocien precios en caja.

### Si el producto tiene presentaciones

Cuando activas multi-tarifa, cada presentación (bulto, caja, six-pack) lleva **su propio precio**, y ese precio es el del **paquete completo**, no el de la unidad. El precio de venta que configuraste arriba sigue siendo el de la unidad suelta.$md$,
  'GUIDE'::help_article_type_enum,
  'PUBLISHED'::help_article_status_enum,
  (SELECT id FROM help_article_categories WHERE slug = 'producto'),
  'Productos',
  ARRAY['precio', 'costo', 'margen', 'rentabilidad', 'oferta', 'impuesto'],
  FALSE,
  20,
  NULL
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------
-- 3. Multi-tarifa: vender un producto en varias presentaciones
-- ---------------------------------------------------------------
INSERT INTO help_articles (title, slug, summary, content, type, status, category_id, module, tags, is_featured, sort_order, created_by_id)
SELECT
  'Multi-tarifa: vender un producto en varias presentaciones',
  'multi-tarifa-vender-un-producto-en-varias-presentaciones',
  'Vende el mismo producto por unidad, por six-pack y por caja con un precio distinto para cada presentación: crear la tarifa, habilitarla en el producto, fijar precio y empaque, y elegir la presentación por defecto.',
  $md$## Vender un producto en varias presentaciones

Una gaseosa se vende por unidad, por six-pack y por caja de 24. Es **un solo producto** y **un solo inventario**: lo que cambia es en qué presentación sale y a qué precio. Eso es multi-tarifa.

### 1. Crea la presentación (una sola vez por tienda)

Ve a **Precios y Tarifas** en el menú izquierdo y pulsa **Nueva Tarifa**.

- **Nombre**: como la reconoce tu equipo — *Six-pack*, *Caja x24*, *Bulto*.
- **Tipo**: elige **Unidad de venta**. (El otro tipo, *Tarifa de cliente*, es para descuentos por tipo de cliente y se explica en su propio artículo.)
- **Cantidad por empaque**: cuántas unidades trae. Six-pack = 6, Caja x24 = 24.

Esta tarifa queda disponible para **todos** los productos de la tienda. La creas una vez y la reutilizas.

### 2. Habilítala en el producto

Abre el producto, ve a **Precios y Tarifas** y enciende **Activar precios multi-tarifa**.

En **Tarifas aplicables** busca y selecciona las presentaciones que aplican a **este** producto. Solo las que selecciones aquí se pueden vender; si alguien intenta vender con una presentación que no está en la lista, la venta se rechaza.

> Al seleccionar tarifas estás **reemplazando** la lista anterior, no sumando. Si vas a agregar una presentación, deja seleccionadas también las que ya tenías.

### 3. Ponle precio a cada presentación

Cada presentación seleccionada abre su propia fila con cuatro campos:

- **Precio**: lo que cuesta el **paquete completo**. Si el six-pack vale $18.000, escribe 18.000 — no el precio de una unidad.
- **Margen (%)**: la rentabilidad de esa presentación, si quieres controlarla aparte.
- **Cantidad x empaque**: cuántas unidades trae en **este** producto. Si lo dejas vacío toma la del paso 1; llénalo solo cuando este producto empaque distinto.
- **Código de barras**: el código propio de la presentación. Escanear la caja en el POS entra la caja, no la unidad.

Verás una etiqueta **Empaque x6** confirmando cuántas unidades descuenta del inventario cada vez que vendes esa presentación.

### 4. Elige la presentación por defecto

Marca una con **Presentación por defecto**. Es la que se muestra en la tienda en línea y la que sale preseleccionada en el POS. En el POS quien vende puede cambiarla al momento.

### 5. Guarda

El inventario se sigue contando en unidades sueltas. Vender un six-pack descuenta 6.

### Ten en cuenta

- **Un producto tiene presentaciones o variantes, nunca las dos.** Si el producto tiene tallas o colores, no puede tener presentaciones de venta, y al revés.
- El precio de una presentación es siempre el del **paquete entero**. No multipliques por la cantidad del empaque.
- Para que el cliente pueda elegir la presentación en la tienda en línea, hay que activar el selector en la configuración de la tienda.$md$,
  'GUIDE'::help_article_type_enum,
  'PUBLISHED'::help_article_status_enum,
  (SELECT id FROM help_article_categories WHERE slug = 'producto'),
  'Productos',
  ARRAY['multitarifa', 'multi-tarifa', 'tarifa', 'presentacion', 'empaque', 'bulto', 'caja', 'six-pack', 'unidad de venta'],
  TRUE,
  30,
  NULL
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------
-- 4. Descuentos por tipo de cliente (tarifas de cliente)
-- ---------------------------------------------------------------
INSERT INTO help_articles (title, slug, summary, content, type, status, category_id, module, tags, is_featured, sort_order, created_by_id)
SELECT
  'Descuentos por tipo de cliente (tarifas de cliente)',
  'descuentos-por-tipo-de-cliente-tarifas-de-cliente',
  'Cobra distinto a mayoristas, distribuidores o clientes frecuentes con una tarifa de cliente, y en qué se diferencia de una presentación de venta.',
  $md$## Descuentos por tipo de cliente

Una **tarifa de cliente** responde a *a quién le vendo*: mayorista, distribuidor, empleado, cliente frecuente. Una **unidad de venta** responde a *en qué presentación lo vendo*: unidad, six-pack, caja.

Son dos ejes distintos y viven en el mismo lugar: **Precios y Tarifas**.

### 1. Crea la tarifa

Ve a **Precios y Tarifas** → **Nueva Tarifa**.

- **Nombre**: *Mayorista*, *Distribuidor*, *Empleados*.
- **Tipo**: elige **Tarifa de cliente**.
- **Descuento (%)**: el descuento que aplica sobre el precio base. Con 15% aquí, todo producto que use esta tarifa sale 15% más barato sin que tengas que escribir precio por producto.

### 2. Aplícala a los productos

Si el descuento porcentual te sirve tal cual, no tienes que hacer nada más en cada producto.

Si un producto específico necesita **otro** precio para esa tarifa —no el porcentaje general—, ábrelo, ve a **Precios y Tarifas**, selecciónala en **Tarifas aplicables** y escribe el **Precio** que quieres para ese cliente. Ese precio manda sobre el porcentaje.

### 3. Úsala al vender

En el POS, al elegir el cliente se aplica su tarifa. Si el cliente no tiene tarifa asignada, se cobra el precio normal.

### Diferencias que importan

| | Tarifa de cliente | Unidad de venta |
|---|---|---|
| Responde a | A quién le vendo | En qué presentación vendo |
| Ejemplo | Mayorista, Empleados | Six-pack, Caja x24 |
| Descuento (%) | Sí, aplica a todos los productos | No aplica |
| Cantidad por empaque | No aplica | Sí, cuántas unidades trae |
| Presentación por defecto | No aplica | Sí, se puede marcar una |

Un producto puede tener tarifas de cliente **y** unidades de venta al mismo tiempo. Lo que nunca puede es tener presentaciones y variantes juntas.$md$,
  'GUIDE'::help_article_type_enum,
  'PUBLISHED'::help_article_status_enum,
  (SELECT id FROM help_article_categories WHERE slug = 'producto'),
  'Productos',
  ARRAY['tarifa', 'cliente', 'mayorista', 'descuento', 'distribuidor', 'precio especial'],
  FALSE,
  40,
  NULL
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------
-- 5. Unidades de medida: compra, inventario y factor de conversión
-- ---------------------------------------------------------------
INSERT INTO help_articles (title, slug, summary, content, type, status, category_id, module, tags, is_featured, sort_order, created_by_id)
SELECT
  'Unidades de medida: compra, inventario y factor de conversión',
  'unidades-de-medida-compra-inventario-y-factor-de-conversion',
  'Compra en bultos y cuenta el inventario en kilos: cómo configurar la unidad de compra, la unidad de inventario y el factor que las convierte.',
  $md$## Unidades de medida

Compras harina por bultos y la usas por kilos. Compras gaseosa por cajas y la vendes por unidad. El producto es uno solo; lo que cambia es la unidad en la que **entra** y la unidad en la que **se cuenta**.

### Las tres piezas

En el editor del producto, en el bloque de unidades:

- **Compra (presentación)**: la unidad en la que le compras al proveedor. *Bulto*, *Caja*, *Galón*.
- **Stock (unidad mínima)**: la unidad en la que quieres contar el inventario y vender. *Kilogramo*, *Unidad*, *Litro*.
- **El factor**: cuántas unidades de inventario trae una unidad de compra.

El formulario te muestra la equivalencia calculada para que la revises de un vistazo: **1 Bulto = 25 Kilogramos**.

### Un ejemplo completo

Harina de trigo:

- Compra (presentación): **Bulto**
- Stock (unidad mínima): **Kilogramo**
- Factor: **25**

Cuando recibes una orden de compra de 4 bultos, el inventario sube **100 kilogramos**. Si el bulto costó $80.000, el costo por kilo queda en $3.200 — el sistema hace la división por ti.

### Cuándo NO necesitas esto

Si compras y vendes en la misma unidad —cajas de tornillos que vendes por caja—, deja las dos unidades iguales y el factor en 1. Es lo normal en la mayoría de productos.

### No confundir con multi-tarifa

Son cosas distintas y se usan juntas sin problema:

- **Unidades de medida** es cómo **entra** la mercancía y en qué se **cuenta**. Mira hacia la compra.
- **Multi-tarifa** es en qué presentación **sale** y a qué precio. Mira hacia la venta.

Puedes comprar por bulto (unidad de medida) y vender por kilo suelto y por bulto entero (dos presentaciones de venta) al mismo tiempo.

### Si te cuadra mal el inventario

Casi siempre es el factor. Revisa que el número corresponda a la presentación real que llega del proveedor: si el proveedor te cambió el bulto de 25 kg a 50 kg y el factor sigue en 25, cada compra registra la mitad de lo que entró.$md$,
  'GUIDE'::help_article_type_enum,
  'PUBLISHED'::help_article_status_enum,
  (SELECT id FROM help_article_categories WHERE slug = 'inventario'),
  'Inventario',
  ARRAY['unidad de medida', 'conversion', 'factor', 'bulto', 'kilo', 'compra', 'inventario'],
  FALSE,
  50,
  NULL
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------
-- 6. Variantes de un producto
-- ---------------------------------------------------------------
INSERT INTO help_articles (title, slug, summary, content, type, status, category_id, module, tags, is_featured, sort_order, created_by_id)
SELECT
  'Variantes de un producto (tallas, colores, sabores)',
  'variantes-de-un-producto',
  'Cuándo usar variantes en vez de productos separados, cómo crearlas, cómo funciona el stock por variante y por qué no se pueden combinar con presentaciones de venta.',
  $md$## Variantes de un producto

Una camiseta en tallas S, M y L y en tres colores es **un producto con variantes**, no nueve productos. Cada variante tiene su propio SKU, su propio código de barras y su propio stock, pero comparten nombre, categoría, impuestos y foto.

### Cuándo usar variantes

- La misma prenda en varias tallas o colores.
- El mismo sabor de producto en presentaciones que el cliente elige.
- Cualquier caso donde quieras **contar el inventario por separado** pero mostrarlo como un solo producto.

Si lo único que cambia es el tamaño del empaque —unidad, six-pack, caja— eso **no** son variantes: son presentaciones de venta (multi-tarifa).

### Cómo crearlas

1. Abre el producto y activa **Este producto tiene variantes**.
2. Define los atributos que varían: *Talla*, *Color*, *Sabor*.
3. Escribe los valores de cada atributo: S, M, L / Rojo, Azul.
4. El sistema genera la combinación de variantes. Puedes borrar las que no vendas.
5. A cada variante ponle su **SKU**, su **código de barras**, su **precio** si es distinto, y su **stock**.

### El stock con variantes

El stock deja de vivir en el producto y pasa a vivir en cada variante. Al activar variantes en un producto que **ya tenía** stock, el sistema te pregunta qué hacer con esas existencias: transferirlas a una variante o distribuirlas. Elige a conciencia — es lo que deja el inventario cuadrado.

Al revés funciona igual: si desactivas variantes, te pregunta qué hacer con el stock que quedaba repartido.

### Variantes y presentaciones no se mezclan

**Un producto tiene variantes o presentaciones de venta, nunca las dos.** Si intentas activar multi-tarifa en un producto con variantes, el sistema te avisa y no lo permite.

La razón es práctica: *camiseta talla M en caja de 12* multiplica las combinaciones y el inventario deja de ser legible. Si de verdad necesitas las dos cosas, crea productos separados por presentación.

### En la tienda en línea

Las variantes sin stock se muestran agotadas, no se esconden. Si no quieres que aparezcan, desactívalas.$md$,
  'GUIDE'::help_article_type_enum,
  'PUBLISHED'::help_article_status_enum,
  (SELECT id FROM help_article_categories WHERE slug = 'producto'),
  'Productos',
  ARRAY['variante', 'talla', 'color', 'sabor', 'sku', 'stock'],
  FALSE,
  60,
  NULL
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------
-- 7. Impuestos de un producto
-- ---------------------------------------------------------------
INSERT INTO help_articles (title, slug, summary, content, type, status, category_id, module, tags, is_featured, sort_order, created_by_id)
SELECT
  'Impuestos de un producto',
  'impuestos-de-un-producto',
  'Cómo asignar IVA u otros impuestos a un producto, qué pasa con el precio final según la configuración de tu tienda, y cómo manejar productos exentos o excluidos.',
  $md$## Impuestos de un producto

En el editor del producto, el bloque **Impuestos Aplicables** define qué impuestos lleva ese producto al venderse.

### Asignar un impuesto

1. Abre el producto y busca **Impuestos Aplicables**.
2. Selecciona los impuestos que apliquen. Un producto puede llevar más de uno (por ejemplo IVA e impuesto al consumo).
3. Si el impuesto que necesitas no existe todavía, puedes crearlo desde ahí mismo sin salir del formulario.
4. **Guarda**.

### Cómo afecta al precio

Depende de cómo esté configurada tu tienda:

- **Precios con impuesto incluido**: el precio de venta que escribiste ya trae el impuesto adentro. El cliente paga exactamente ese número y en la factura se muestra cuánto de ese total es impuesto.
- **Precios sin impuesto**: el impuesto se suma al final. El cliente paga más que el precio de venta.

El campo **Precio Final** del editor te muestra el resultado de tu configuración actual, para que no tengas que hacer la cuenta.

### Productos exentos y excluidos

No es lo mismo:

- **Exento**: lleva impuesto a tarifa 0%. Se declara, pero no cobra nada al cliente.
- **Excluido**: no está sujeto al impuesto. Sencillamente no lleva ninguno asignado.

Si vendes canasta familiar, medicamentos o servicios excluidos, revisa con tu contador cuál corresponde: la diferencia importa en la declaración, aunque el cliente pague lo mismo.

### Si cambias el impuesto de un producto

El cambio aplica a las ventas nuevas. Las facturas ya emitidas conservan el impuesto con el que se emitieron — y así debe ser: una factura no se reescribe.

### Impuestos y presentaciones

El impuesto se define **en el producto**, no en la presentación. Si un producto se vende por unidad y por caja, ambas presentaciones llevan el mismo impuesto sobre su propio precio.$md$,
  'GUIDE'::help_article_type_enum,
  'PUBLISHED'::help_article_status_enum,
  (SELECT id FROM help_article_categories WHERE slug = 'producto'),
  'Productos',
  ARRAY['impuesto', 'iva', 'exento', 'excluido', 'precio final', 'factura'],
  FALSE,
  70,
  NULL
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------
-- 8. Mostrar las presentaciones en la tienda en línea
-- ---------------------------------------------------------------
INSERT INTO help_articles (title, slug, summary, content, type, status, category_id, module, tags, is_featured, sort_order, created_by_id)
SELECT
  'Mostrar las presentaciones de venta en la tienda en línea',
  'mostrar-presentaciones-en-la-tienda-en-linea',
  'Activa el selector para que el comprador elija en la ficha del producto si compra por unidad, por bulto o por caja, y entienda qué precio está viendo.',
  $md$## Mostrar las presentaciones en la tienda en línea

Si configuraste multi-tarifa en un producto, por defecto la tienda en línea muestra **una sola** presentación: la que marcaste como **Presentación por defecto**. Para que el comprador pueda elegir, hay que encender el selector.

### 1. Activa el selector

Ve a la configuración de tu **Tienda en línea**, sección de catálogo, y enciende **Permitir elegir presentación de venta**.

Con eso, la ficha de todo producto que tenga más de una presentación muestra las opciones disponibles con su precio, y el comprador elige en cuál comprar.

### 2. Revisa cómo queda

Abre la tienda y entra a un producto con presentaciones. Deberías ver algo como:

- Unidad — $3.500
- Six-pack — $18.000
- Caja x24 — $68.000

El precio de cada opción es el del **paquete completo**, no el de la unidad. Si el comprador pone 2 six-packs en el carrito, paga $36.000 y el inventario descuenta 12 unidades.

### 3. Qué pasa en el carrito y en el checkout

La presentación elegida viaja con el producto hasta la orden. En la orden verás la presentación y la cantidad de paquetes, no de unidades sueltas. El descuento de inventario sí se hace en unidades.

Funciona igual en el checkout por WhatsApp.

### Si el selector no aparece

Revisa en orden:

1. **El interruptor está encendido** en la configuración de la tienda en línea.
2. **El producto tiene más de una presentación** seleccionada en **Tarifas aplicables**. Con una sola no hay nada que elegir y el selector no se muestra.
3. **Las presentaciones tienen precio.** Una presentación sin precio no se ofrece.
4. **El producto está disponible en la tienda en línea.**

### Ten en cuenta

Elegir la presentación al vender también se puede hacer desde el POS, y ahí no depende de este interruptor: quien vende siempre puede cambiarla.$md$,
  'GUIDE'::help_article_type_enum,
  'PUBLISHED'::help_article_status_enum,
  (SELECT id FROM help_article_categories WHERE slug = 'e-commerce'),
  'Tienda en línea',
  ARRAY['tienda en linea', 'ecommerce', 'presentacion', 'multitarifa', 'catalogo', 'selector'],
  FALSE,
  80,
  NULL
ON CONFLICT (slug) DO NOTHING;

COMMIT;
