export interface SectorGuide {
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly intro: string;
  readonly sections: ReadonlyArray<{
    heading: string;
    paragraphs: readonly string[];
  }>;
  readonly checklist: readonly string[];
}

export const SECTOR_GUIDES: Readonly<Record<string, SectorGuide>> = {
  'comandas-restaurantes': {
    title: 'Cómo organizar las comandas entre mesa, cocina y caja',
    description:
      'Coordina mesa, pedido, cocina y caja: define cómo comunicar cambios y prepara una demostración con el flujo de tu restaurante.',
    category: 'Restaurantes y sushi',
    intro:
      'Un pedido pasa por varias manos: quien atiende la mesa, quien prepara y quien cobra. Define qué información necesita cada equipo y cómo se comunican los cambios antes de configurar una herramienta.',
    sections: [
      {
        heading: 'Empieza por la mesa y el pedido',
        paragraphs: [
          'Identifica la mesa o modalidad de atención. Registra productos, cantidades y observaciones. Si alguien agrega otro plato, deja claro a qué pedido pertenece. Para una carta de sushi, utiliza tus platos y opciones reales en la demostración.',
        ],
      },
      {
        heading: 'Separa tomar el pedido de enviarlo a cocina',
        paragraphs: [
          'Define quién revisa y confirma la comanda. Las observaciones deben llegar a quien prepara, y los cambios posteriores necesitan un procedimiento acordado.',
          'Un campo de notas no reemplaza el protocolo del restaurante para alergias o restricciones alimentarias.',
        ],
      },
      {
        heading: 'Acuerda cómo consultar el avance',
        paragraphs: [
          'Salón y cocina deben reconocer qué está pendiente, qué se prepara y qué puede entregarse. Revisa los nombres de los estados y quién puede cambiarlos. Pide comprobar ese recorrido, no solo ver una lista de funciones.',
        ],
      },
      {
        heading: 'Define cómo corregir o cancelar',
        paragraphs: [
          'Identifica el producto y comprueba si comenzó su preparación. Registra el motivo cuando el sistema lo solicita y comunica el cambio a cocina. Revisa cómo queda la cuenta y qué ocurre con los insumos.',
        ],
      },
      {
        heading: 'Revisa la cuenta antes de cobrar',
        paragraphs: [
          'Contrasta cantidades, productos cancelados y total. Si necesitas dividir cuentas o aceptar varios pagos, incluye esos casos en la demostración. Comprueba también quién confirma que la mesa puede recibir nuevos clientes.',
        ],
      },
      {
        heading: 'Prepara una demostración de tu operación',
        paragraphs: [
          'Elige una mesa de prueba, dos productos y una observación. Define los roles de salón, cocina y caja e incluye un cambio o cancelación. Para preparación, inventario y pago, utiliza un entorno de prueba acordado; no ensayes con cuentas de clientes.',
        ],
      },
    ],
    checklist: [
      'Mesa y modalidad de atención de prueba.',
      'Dos productos, cantidades y precios esperados.',
      'Una observación ficticia de preparación.',
      'Roles de salón, cocina y caja con permisos confirmados.',
      'Cambio o cancelación con su motivo y resultado esperado.',
      'Entorno autorizado y procedimiento de limpieza.',
    ],
  },
  'ventas-mayoristas-al-detal': {
    title:
      'Cómo organizar las ventas al por mayor y al detal en una misma bodega',
    description:
      'Organiza precios mayoristas y al detal, distingue tarifas y promociones y prepara una demostración con tus productos y condiciones.',
    category: 'Mayoristas y comercio',
    intro:
      'Una bodega puede vender una unidad a un comprador y varias referencias a quien surte su negocio. Define qué precio corresponde, quién puede aplicarlo y cómo se revisa el total.',
    sections: [
      {
        heading: 'Define cuándo aplica cada precio',
        paragraphs: [
          'Escribe las condiciones del precio habitual y del acuerdo mayorista: productos, presentaciones, comprador o cantidad. Son reglas de tu negocio; no implican que una herramienta las aplique automáticamente. Comprueba cómo se configura y selecciona el mecanismo que necesitas.',
        ],
      },
      {
        heading: 'Distingue tarifa, cupón y promoción',
        paragraphs: [
          'Una tarifa organiza un precio comercial distinto. Un cupón aplica un beneficio mediante un código. Una promoción puede limitarse a ciertos productos y condiciones. Acuerda qué debe ocurrir cuando coinciden.',
          'En una prueba controlada de Vendix se seleccionó manualmente una tarifa, se aplicó y retiró un cupón válido y se comprobó una promoción limitada a un producto. No se verificó acumulación ni selección automática por comprador o cantidad.',
        ],
      },
      {
        heading: 'Calcula el resultado antes de demostrarlo',
        paragraphs: [
          'Ejemplo ilustrativo: precio habitual de $10.000 COP y precio comercial acordado de $9.000 COP. Cinco unidades bajo ese acuerdo suman $45.000 COP antes de otros conceptos que correspondan. No establece impuestos, transporte ni precios de suscripción.',
          'Comprueba cantidad, precio y descuento. Si retiras un beneficio, revisa el nuevo total. Un código rechazado no debe producir descuentos ni cambiar el valor de la compra.',
        ],
      },
      {
        heading: 'Mantén claras las presentaciones',
        paragraphs: [
          'Si compras por cajas y vendes por unidades, documenta cuántas unidades contiene cada presentación. Pide una prueba específica de esa conversión antes de depender de ella. Un precio mayorista no demuestra por sí solo manejo de empaques o inventario.',
        ],
      },
      {
        heading: 'Comprueba la operación completa',
        paragraphs: [
          'Prepara una existencia inicial conocida, una cantidad de venta y el resultado esperado. Revisa precios, cobro, movimiento y reversión en un entorno de prueba acordado. Las pruebas de descuentos en carrito no sustituyen ese recorrido.',
        ],
      },
    ],
    checklist: [
      'Producto, SKU, presentación y precio habitual.',
      'Condición que diferencia mayorista y al detal.',
      'Tarifa o beneficio temporal y sus restricciones.',
      'Política esperada cuando coinciden descuentos.',
      'Total y movimiento de inventario esperados.',
      'Plan, permisos, entorno autorizado y reversión.',
    ],
  },
  'preparar-demostracion': {
    title: 'Prepara una demostración con un caso de tu negocio',
    description:
      'Define productos, roles y resultados esperados para evaluar el flujo de tu operación con el equipo.',
    category: 'Preparación',
    intro:
      'Una demostración resulta más útil cuando tiene datos y expectativas claras. Esta lista te ayuda a prepararlos; no envía una solicitud ni crea una cuenta.',
    sections: [
      {
        heading: 'Elige una operación concreta',
        paragraphs: [
          'Para un restaurante, recorre una mesa y sus pedidos. Para una bodega, compara una venta habitual y una condición mayorista. Empieza por un caso que tu equipo use realmente.',
        ],
      },
      {
        heading: 'Define qué debe ocurrir',
        paragraphs: [
          'Anota los productos, cantidades, precios y observaciones. Calcula el resultado esperado y acuerda quién hace cada paso. Confirma las funciones disponibles, el plan y la configuración aplicables.',
        ],
      },
      {
        heading: 'Prueba sin afectar clientes',
        paragraphs: [
          'Usa datos ficticios y un entorno autorizado. Antes de preparar, descontar inventario o simular un pago, acuerda los efectos y la reversión. No uses pedidos de clientes ni cobros reales para ensayar.',
        ],
      },
      {
        heading: 'Revisa resultados y pendientes',
        paragraphs: [
          'Distingue lo demostrado de lo que falta. Que un descuento aparezca en el carrito no prueba un cobro final; que una comanda llegue a cocina no prueba preparación, entrega y cierre completos. Conserva evidencia sin datos personales.',
        ],
      },
    ],
    checklist: [
      'Sector y operación que quieres evaluar.',
      'Productos ficticios con cantidades y precios.',
      'Roles del equipo y permisos necesarios.',
      'Resultado esperado para cada paso.',
      'Plan y configuración por confirmar.',
      'Entorno de prueba y limpieza al finalizar.',
    ],
  },
  // SEO-OPS-23 (2026-10-29): borradores de caja e inventario. Publicación desactivada con el
  // mismo gate (sectorGuidesEnabled=false en producción). Fuentes de código y revisiones
  // pendientes (QA en cuenta demo, contador) en docs/seo/seguimiento/entregas.
  'cierre-de-caja': {
    title: 'Cómo hacer el cierre de caja diario, paso a paso',
    description:
      'Cuadra la caja al final del turno: qué contar, cómo calcular el efectivo esperado, errores frecuentes y cómo se hace el cierre en Vendix.',
    category: 'Caja y punto de venta',
    intro:
      'El cierre de caja responde una pregunta sencilla: ¿el dinero que hay en la caja es el que debería haber? Hacerlo al final de cada turno te permite encontrar errores cuando todavía recuerdas qué pasó.',
    sections: [
      {
        heading: 'Qué necesitas antes de empezar',
        paragraphs: [
          'El efectivo con el que abriste el turno (la base), las ventas del turno separadas por medio de pago, las entradas y salidas de efectivo que no son ventas, las devoluciones pagadas en efectivo y el cierre del datáfono.',
        ],
      },
      {
        heading: 'El cuadre de efectivo, en una fórmula',
        paragraphs: [
          'Efectivo esperado = base + ventas en efectivo + entradas − salidas − devoluciones en efectivo. Por ejemplo (cifras ilustrativas): con $100.000 de base, $450.000 en ventas en efectivo, $20.000 de entrada, $60.000 de salida y $15.000 de devolución, el esperado es $495.000. Si contaste $490.000, hay un faltante de $5.000.',
          'Las ventas con tarjeta o transferencia no van en esta cuenta porque no entran al cajón: se revisan aparte contra el datáfono y el banco.',
        ],
      },
      {
        heading: 'Paso a paso',
        paragraphs: [
          'Deja de vender en esa caja y cierra las ventas pendientes. Cuenta el efectivo por denominación, calcula el esperado y compara. Revisa tarjeta y transferencias por fuera, explica por escrito cualquier diferencia, separa la base del siguiente turno y guarda el informe.',
        ],
      },
      {
        heading: 'Errores frecuentes',
        paragraphs: [
          'Sacar dinero del cajón sin registrarlo, registrar como efectivo una venta con tarjeta, mezclar la base con las ventas, que dos personas cobren en el mismo cajón y cerrar sin anotar la diferencia. Las diferencias pequeñas y repetidas son una señal.',
        ],
      },
      {
        heading: 'Cómo se hace en Vendix',
        paragraphs: [
          'Activa el control de caja en la configuración del POS. Al iniciar el turno eliges Abrir Caja y escribes el Monto de Apertura; una caja no puede tener dos turnos abiertos y cada usuario trabaja con una caja a la vez. Las entradas y salidas que no son ventas se registran como Movimiento de Efectivo, con monto y referencia.',
          'Al cerrar, Vendix muestra las ventas por medio de pago y el Efectivo Esperado en Caja, calculado con la misma fórmula. Escribes el Conteo Real de Efectivo y Vendix indica si hay sobrante o faltante; puedes dejar notas de cierre e imprimir el informe. Si quedan órdenes pendientes, te avisa y pide un motivo para cerrar de todas formas.',
          'Vendix muestra el efectivo esperado antes de que escribas tu conteo. Si quieres contar a ciegas, cuenta primero y anota tu cifra antes de abrir el cierre. Abrir, cerrar y registrar movimientos son permisos distintos.',
        ],
      },
    ],
    checklist: [
      'Base de apertura registrada al iniciar el turno.',
      'Entradas y salidas de efectivo con referencia.',
      'Ventas pendientes cerradas antes de contar.',
      'Efectivo contado por denominación.',
      'Diferencia anotada y explicada por escrito.',
      'Tarjeta y transferencias revisadas contra datáfono y banco.',
      'Informe de cierre impreso o archivado.',
    ],
  },
  'control-de-inventario': {
    title: 'Cómo controlar el inventario de tu negocio',
    description:
      'Cuenta, ajusta con motivo, define un stock mínimo y traslada mercancía con registro. Incluye cómo se hace en Vendix y un checklist semanal.',
    category: 'Inventario',
    intro:
      'Controlar el inventario es lograr que el número del sistema sea el que hay en la estantería. El método tiene cuatro piezas: contar, ajustar con motivo, avisar a tiempo con un stock mínimo y mover mercancía con registro.',
    sections: [
      {
        heading: 'Cuenta lo que tienes',
        paragraphs: [
          'Combina un conteo completo una o dos veces al año con conteos por partes cada semana: los productos que más vendes, los más caros o los que más se pierden. Congela la zona mientras cuentas, cuenta en la unidad en que vendes, anota por ubicación y compara contra el sistema solo al final.',
        ],
      },
      {
        heading: 'Ajusta las diferencias, siempre con motivo',
        paragraphs: [
          'No es lo mismo una diferencia de conteo que un daño, un vencimiento, una pérdida o una corrección de digitación. Separar los motivos muestra dónde se va el dinero: si casi todo es vencido, el problema está en las compras.',
        ],
      },
      {
        heading: 'Define un stock mínimo para cada producto',
        paragraphs: [
          'Stock mínimo = ventas diarias promedio × (días de entrega del proveedor + días de margen). Por ejemplo (cifras ilustrativas): 4 unidades al día × (5 + 2) días = 28 unidades. Revísalo cuando cambie la temporada o el proveedor.',
        ],
      },
      {
        heading: 'Mueve la mercancía con registro',
        paragraphs: [
          'Cada traslado entre bodega y local, o entre sedes, debe decir qué sale, de dónde, a dónde y cuánto llegó. Quien recibe cuenta lo que llegó y lo confirma en ese momento.',
        ],
      },
      {
        heading: 'Cómo se hace en Vendix',
        paragraphs: [
          'En Inventario › Ubicaciones creas cada bodega o local y marcas la bodega principal; con la configuración por defecto, el punto de venta descuenta de ella. En Ajustes de Stock registras la cantidad contada con su tipo (Daño, Pérdida, Robo, Vencido, Conteo o Corrección) y Vendix calcula la diferencia; para un conteo completo puedes usar la carga masiva con la plantilla de productos existentes.',
          'El umbral de stock bajo se define para toda la tienda (10 unidades por defecto) o por producto, y Vendix crea una notificación de stock bajo cuando se alcanza. En Transferencias registras origen, destino y productos; al aprobar se apartan las unidades y al recibir se suman al destino. En Movimientos ves el historial de ventas, compras, ajustes y transferencias.',
        ],
      },
    ],
    checklist: [
      'Contar cada semana un grupo de productos.',
      'Registrar cada diferencia como ajuste con su tipo.',
      'Revisar los avisos de stock bajo y hacer los pedidos.',
      'Recibir las transferencias contando lo que llegó.',
      'Sumar cada mes los ajustes por tipo.',
      'Revisar los mínimos de lo que se agotó o sobró.',
      'Conteo completo una o dos veces al año.',
    ],
  },
  'elegir-software-pos': {
    title: 'Cómo elegir un software POS para tu negocio en Colombia',
    description:
      'Nueve criterios para comparar un POS: facturación electrónica DIAN, inventario, sedes, lector, impresora, internet, soporte, migración y precio total.',
    category: 'Punto de venta',
    intro:
      'Elegir un POS es decidir cómo vas a vender, cobrar y facturar durante años. Esta guía te da nueve criterios para comparar a cualquier proveedor, una prueba que puedes hacer en la demostración y una lista para puntuar. Al final explicamos cómo cumple Vendix cada criterio, con sus límites.',
    sections: [
      {
        heading: 'Antes de comparar, escribe cómo vendes',
        paragraphs: [
          'Anota en media página cuántas cajas y cajeros tienes, si vendes por código de barras, por peso o con tallas y colores, cuántos locales o bodegas manejas, cómo te pagan (efectivo, tarjeta, transferencia) y quién te hace la factura hoy. Con eso evalúas lo que necesitas, no lo que el vendedor quiere mostrar.',
        ],
      },
      {
        heading: 'Criterios 1 a 3: facturación electrónica, inventario y sedes',
        paragraphs: [
          '1. Facturación electrónica DIAN y su plan. Pregunta qué documentos emite (factura electrónica de venta, notas crédito y, si tu actividad lo requiere, el documento equivalente del POS; confirma con tu contador cuál te corresponde), en qué plan viene, quién tramita el certificado digital y la habilitación ante la DIAN, y si cobran por folio. Desconfía de quien te promete una fecha de habilitación: el tiempo depende de la DIAN y de tu comercio.',
          '2. Inventario. El stock debe bajar solo al vender, avisarte antes de agotarse y dejarte corregir diferencias con un motivo. Pregunta si permite vender sin existencias, si hay conteos y ajustes con historial y si maneja variantes como talla y color. Desconfía de un inventario que solo se actualiza al cierre del día.',
          '3. Varias sedes. Pregunta si puedes tener bodega y local, o dos sedes, con traslados registrados, y si cada punto de venta descuenta de la ubicación correcta. Desconfía de quien cobra aparte por cada sede sin decírtelo desde el inicio.',
        ],
      },
      {
        heading: 'Criterios 4 a 6: lector, impresora e internet',
        paragraphs: [
          '4. Lector de códigos. Lo habitual es un lector USB o Bluetooth que escribe el código como si fuera un teclado. Pregunta si lo soporta, si hay que activarlo y si también lee con la cámara del celular. Desconfía de un «compatible con todo» sin demostración con tu lector.',
          '5. Impresora. Hay dos caminos: imprimir desde el navegador, con la impresora instalada en tu equipo, o enviar comandos directos a una impresora térmica. Pregunta cuál usa y prueba tu modelo, en papel de rollo si es el que usas. Desconfía de un «100 % compatible» sin lista de modelos probados.',
          '6. Internet requerido. Pregunta qué pasa cuando se cae la conexión y desconecta el wifi durante la demostración para verlo. Muchos POS en la nube necesitan conexión para vender; si te prometen otra cosa, pide verla funcionar. Ten siempre un plan B, como los datos del celular.',
        ],
      },
      {
        heading: 'Criterios 7 a 9: soporte, migración y precio total',
        paragraphs: [
          '7. Soporte. Pregunta por qué canales atienden, en qué horarios y qué tiempo de respuesta se comprometen por escrito. Desconfía de un «soporte garantizado» sin condiciones.',
          '8. Migración. Pregunta qué datos entran (productos, clientes, existencias), en qué formato y quién los carga. Pregunta también qué no entra: casi nunca se trasladan el historial de ventas, las facturas ni la contabilidad, así que conserva tu sistema anterior para consulta. Revisa la guía para pasar tus productos de Excel a un POS (/guias/pasar-productos-excel-a-pos).',
          '9. Precio total. Suma durante un año la suscripción, los usuarios o sedes adicionales, los folios de facturación, las comisiones por venta, los equipos (lector, impresora, tablet), la implementación o capacitación y el costo de salir (permanencia, exportación de tus datos). Compara ese total, no el precio de portada.',
        ],
      },
      {
        heading: 'Haz esta prueba en la demostración',
        paragraphs: [
          'Lleva 10 de tus productos: uno que se venda por peso, uno con variantes y uno con código de barras. Vende dos productos en efectivo y uno con tarjeta. Haz una devolución y revisa que el stock vuelva. Cierra la caja y mira si el efectivo esperado coincide con tu cuenta (guía de cierre de caja: /guias/cierre-de-caja). Imprime el comprobante en tu impresora y pide ver el flujo de facturación electrónica de principio a fin, con lo que falta para habilitarlo.',
          'Después puntúa cada criterio de 1 a 5 y multiplícalo por el peso que le das según tu negocio. Compara hasta tres proveedores con la misma lista.',
        ],
      },
      {
        heading: 'Cómo cumple Vendix cada criterio',
        paragraphs: [
          'Facturación electrónica DIAN: está en los planes Empresarial Pro e IA Business; los planes Impulsa y Emprendedor no facturan electrónicamente. Requiere que tu comercio complete la habilitación: si ya configuraste la facturación electrónica, Vendix no deja emitir documentos que gasten numeración hasta que la habilitación esté en producción. No prometemos plazos de habilitación.',
          'Inventario: el stock baja al cobrar y, por defecto, no deja vender más de lo que hay. Avisa con una notificación de stock bajo (umbral de 10 unidades, ajustable) y permite conteos, ajustes con motivo y traslados. Mira la guía de control de inventario (/guias/control-de-inventario). Varias sedes: maneja varias ubicaciones, como bodega y local, con traslados que se aprueban y se reciben; por defecto el POS descuenta de la bodega principal.',
          'Lector e impresora: sirve un lector USB o Bluetooth que escriba como teclado y se activa en la configuración del POS, donde viene apagado; no lee con la cámara. Imprime con el diálogo de impresión del navegador, en papel de rollo u hoja, y no envía comandos directos a la impresora.',
          'Internet: Vendix requiere conexión a internet para vender. Migración: importas productos y clientes desde Excel o CSV con plantillas; no se traen ventas, facturas ni contabilidad, y la carga la haces tú. Si prefieres que el equipo cargue muchos productos, se cotiza como implementación avanzada. Precio: consulta los planes y las condiciones de la prueba en /pricing.',
        ],
      },
      {
        heading: 'Preguntas frecuentes',
        paragraphs: [
          '¿Necesito un POS con facturación electrónica? Depende de si tu actividad está obligada a facturar electrónicamente. Confirma con tu contador antes de elegir; si lo estás, haz del criterio 1 el de mayor peso.',
          '¿Un POS funciona sin internet? Depende del proveedor: pregúntalo y compruébalo desconectando el wifi en la demostración. En Vendix se necesita conexión para vender.',
          '¿Cuánto cuesta un software POS? No hay un precio único. Calcula el costo total a un año con la lista del criterio 9 y compáralo entre proveedores.',
          '¿Cuánto tarda cambiar de sistema? Depende de cuántos productos tengas y de qué tan limpia esté tu lista. Desconfía de plazos fijos prometidos sin ver tus datos; la habilitación ante la DIAN tampoco depende del proveedor.',
        ],
      },
    ],
    checklist: [
      'Media página con cómo vendes: cajas, cajeros, sedes y medios de pago.',
      'Los tres proveedores que vas a comparar y el peso de cada criterio.',
      'Confirmación de tu contador sobre si debes facturar electrónicamente.',
      'Diez productos de prueba: uno por peso, uno con variantes y uno con código de barras.',
      'Tu lector de códigos y tu impresora para probarlos en la demostración.',
      'Una prueba de cinco ventas: efectivo, tarjeta, devolución, cierre de caja e impresión.',
      'El costo total a un año de cada proveedor, con equipos y salida incluidos.',
    ],
  },
  'pasar-productos-excel-a-pos': {
    title: 'Cómo pasar tus productos de Excel a un POS paso a paso',
    description:
      'Cómo preparar tu archivo, manejar variantes, cargar existencias por ubicación, evitar duplicados y validar con una muestra antes de migrar a un POS.',
    category: 'Migración',
    intro:
      'Pasar tu catálogo a un sistema nuevo no es copiar y pegar: es limpiar, ordenar, probar y comparar. Si lo haces en ese orden, el día que empieces a vender los números coinciden. Esta guía sirve para cualquier POS y al final muestra cómo se hace en Vendix.',
    sections: [
      {
        heading: 'Define qué pasas y qué no',
        paragraphs: [
          'Casi siempre se pueden pasar productos, variantes, precios, existencias y clientes. Casi nunca se pasan el historial de ventas, las facturas electrónicas emitidas, la contabilidad ni la cartera: esos datos los conservas en tu sistema anterior, o en archivos, para consultarlos. Haz un respaldo del archivo original y no lo modifiques: es tu punto de comparación.',
        ],
      },
      {
        heading: 'Prepara el archivo',
        paragraphs: [
          'Trabaja en una copia, con una fila por producto. Las columnas mínimas son: nombre claro; SKU único (si no tienes, invéntalo con un patrón como CAM-NEG-M); código de barras en formato texto, para no perder ceros iniciales ni terminar en notación científica; precio de venta solo con números (8500 u 8.500, sin signo de pesos); costo de compra, necesario para valorar el inventario; categoría y marca escritas siempre igual; unidad de venta; y la existencia contada, no un cálculo.',
          'Borra las filas vacías, quita los productos que ya no vendes y corrige el mismo producto escrito de dos maneras antes de subir. «Papelería» y «Papeleria» serían dos categorías distintas.',
        ],
      },
      {
        heading: 'Variantes: un padre y varias hijas',
        paragraphs: [
          'Para tallas, colores o sabores, crea una fila padre (la camiseta) y una fila por variante (negro M, blanco M), cada una con su propio SKU y sus atributos (Color, Talla). Las variantes de un mismo padre deben usar los mismos nombres de atributo, escritos igual.',
        ],
      },
      {
        heading: 'Existencias iniciales por ubicación',
        paragraphs: [
          'Las existencias dependen de dónde están: no es lo mismo la bodega que el local. Cuenta el día del corte, ubicación por ubicación, y carga esa cifra como saldo, no como suma sobre lo anterior. Si sigues vendiendo en el sistema viejo mientras cargas, tus números nacen desactualizados: define un día y una hora de corte.',
        ],
      },
      {
        heading: 'Revisa duplicados y prueba con una muestra',
        paragraphs: [
          'Antes de subir, busca en tu hoja SKU repetidos, códigos de barras repetidos y nombres casi iguales, y decide cuál fila queda. Un duplicado que entra al sistema cuesta más corregirlo que prevenirlo.',
          'Sube primero 10 filas que incluyan un producto simple, uno por peso, uno con variantes y uno sin inventario. Revisa cómo quedaron, haz una venta de prueba y solo entonces sube el archivo completo.',
        ],
      },
      {
        heading: 'Valida con tu lista de control',
        paragraphs: [
          'Productos: cuenta las filas del archivo y los productos en el sistema; deben ser iguales. Variantes: las filas hijas deben coincidir con las variantes creadas. Existencias: suma las unidades por ubicación y revisa 10 productos al azar contra tu conteo. Precios: revisa 10 productos al azar contra el archivo. Duplicados: sube el mismo archivo otra vez y comprueba que no se creen repetidos. Venta de prueba: vende un producto y verifica que su stock baje en 1.',
        ],
      },
      {
        heading: 'Cómo se hace en Vendix',
        paragraphs: [
          'Dónde y con qué archivo. En Productos, el menú tiene Carga Masiva y Descargar Plantilla con Productos Actuales. La carga acepta archivos .xlsx, .xls o .csv, lee la primera hoja y admite hasta 10.000 filas y 20 MB por archivo. Descarga la plantilla de Productos (la de Servicios es otra). Los encabezados se reconocen sin importar mayúsculas ni tildes, pero una columna con un nombre que Vendix no conoce se ignora en silencio: no cambies los nombres. Son obligatorios Nombre, SKU y Precio Venta.',
          'Revisión antes de guardar. Pulsa Analizar Archivo: Vendix muestra cuántas filas están listas, con advertencias o con errores, y el análisis no guarda nada. Los errores más comunes son un precio que no es un número, un código de barras en notación científica o de más de 64 caracteres, y un código de barras ya usado por otro producto. Las categorías y marcas nuevas se crean solas, con aviso.',
          'Variantes. En la fila de la variante escribe el SKU Padre (el SKU de la fila padre, que debe estar en el mismo archivo) y hasta tres pares Atributo y Valor. Sin padre en el archivo, la fila se rechaza; sin atributos o con SKU repetido, es un error.',
          'Existencias de un producto simple. Con Cantidad Inicial y Precio Compra en la plantilla, Vendix carga el saldo en la ubicación principal (la bodega marcada como principal) como Carga inicial, y te pide marcar una confirmación porque cambia stock y costo. Si el saldo ya coincide, no hace nada.',
          'Existencias por ubicación y por variante. La Cantidad Inicial no aplica a productos con variantes. Para eso, y para cargar una bodega distinta, usa Inventario, Ajustes de Stock, Carga Masiva: eliges la ubicación y el tipo de ajuste, descargas la plantilla de productos existentes (trae una fila por variante, con el SKU de la variante), llenas Cantidad Nueva y subes. Las entradas sin stock en esa bodega se registran como Carga inicial.',
          'Duplicados. Un SKU que ya existe en tu tienda actualiza ese producto en vez de crear otro; si estaba archivado, lo reactiva con aviso. Un SKU repetido dentro del archivo genera una advertencia: corrígelo antes de guardar. Un código de barras repetido, en el archivo o ya en uso, es un error. En clientes, si el correo o el documento ya existe, la fila se rechaza: esta carga no actualiza clientes.',
          'Al reimportar. Si subes el mismo archivo, los productos con el mismo SKU se actualizan. Ten cuidado con la Cantidad Inicial: si el saldo del archivo es distinto al actual, Vendix lo ajusta a la cantidad del archivo. La descarga con productos actuales trae la existencia en otra columna y deja vacía la Cantidad Inicial para no recargar. Las fotos se cargan aparte, con un ZIP asociado por SKU.',
          'Lo que no se trae. No existe importador de historial de ventas, facturas, contabilidad, cartera ni proveedores, y Vendix no se conecta con tu programa anterior: exportas tus datos a Excel o CSV y los pasas a la plantilla. La carga la haces tú; si prefieres que el equipo cargue muchos productos, se cotiza como implementación avanzada. No compartas tu base completa por canales informales: para consultar un caso bastan pocas filas.',
        ],
      },
      {
        heading: 'Preguntas frecuentes',
        paragraphs: [
          '¿Puedo importar desde otro programa? Exporta tus datos a Excel o CSV y pásalos a la plantilla. No hay conexión directa entre programas.',
          '¿Qué pasa si subo el mismo archivo dos veces? Los productos con el mismo SKU se actualizan, no se duplican. Los clientes repetidos se rechazan.',
          '¿Cómo cargo existencias de varias bodegas o de productos con variantes? Con Ajustes de Stock, Carga Masiva, eligiendo la ubicación y usando el SKU de cada variante.',
          '¿Se pasan mis facturas y mi contabilidad? No. Solo catálogo, clientes, existencias y fotos. Para saber cómo queda el inventario después, mira la guía de control de inventario (/guias/control-de-inventario).',
        ],
      },
    ],
    checklist: [
      'Respaldo del archivo original, sin modificarlo.',
      'Copia de trabajo con una fila por producto y SKU únicos.',
      'Códigos de barras en formato texto y precios solo con números.',
      'Filas padre y filas hijas para productos con variantes.',
      'Día y hora de corte, con el conteo por ubicación.',
      'Muestra de 10 filas subida y revisada antes del archivo completo.',
      'Lista de control: productos, variantes, existencias, precios y venta de prueba.',
    ],
  },
};
