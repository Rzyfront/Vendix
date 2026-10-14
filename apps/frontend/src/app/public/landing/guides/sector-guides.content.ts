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
};
