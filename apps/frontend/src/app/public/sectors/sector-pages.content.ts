import { MarketingPageMetadata } from '../marketing-page-metadata';

/**
 * Plantilla de páginas de sector y solución de la web comercial (SEO-TECH-08, SEO-OPS-17).
 *
 * Cada página es un registro de datos: el componente no tiene texto propio. Reglas
 * (registro editorial y claims-register):
 * - Solo se escribe lo que tiene evidencia (`evidence`): demo en pantalla o código.
 *   Lo que todavía no tiene demo no entra (propina, QR de mesa, comanda impresa…).
 * - Todas van en `noindex` y sin canonical hasta la firma de Producto y Ventas (G4).
 * - Las rutas y el interruptor viven en `sector-pages.config.ts` (apagado en producción).
 */
export interface EvidencedText {
  text: string;
  /** De dónde sale la afirmación: demo (fecha y archivo) o código (ruta). No se muestra. */
  evidence: string;
}

export interface SectorStep extends EvidencedText {
  title: string;
}

export interface SectorSection {
  id: string;
  heading: string;
  paragraphs?: readonly EvidencedText[];
  bullets?: readonly EvidencedText[];
}

export interface SectorFaq extends EvidencedText {
  question: string;
}

export interface SectorPageContent {
  /** Ruta sin barra inicial; debe coincidir con el registro editorial. */
  path: string;
  metadata: MarketingPageMetadata;
  label: string;
  h1: string;
  intro: string;
  /** Título del recorrido (por defecto «Así se mueve un pedido»). */
  stepsHeading?: string;
  steps: readonly SectorStep[];
  sections: readonly SectorSection[];
  limits: readonly EvidencedText[];
  prepare: readonly string[];
  faqs: readonly SectorFaq[];
  /** Mensaje de WhatsApp sin datos personales. */
  whatsappText: string;
}

const DEMO_11_NOV = 'Demo 11-nov-2026, tienda demo Pit & Grill (seguimiento: evidencias/demo-pit-and-grill-2026-11-11.md)';
const DEMO_13_OCT = 'Demo 13-oct-2026 (seguimiento: evidencias/restaurante-mesa6-demo-2026-10-13.md)';

/** SEO-OPS-17: página de restaurantes. Texto del borrador v3 (11-nov), solo lo comprobado. */
const RESTAURANTES: SectorPageContent = {
  path: 'sectores/restaurantes',
  metadata: {
    title: 'Software para restaurantes en Colombia | Vendix',
    description:
      'Abre mesas, envía comandas a la pantalla de cocina y controla cada cuenta. Mira el recorrido de Vendix con datos de prueba y agenda una demostración.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  label: 'Restaurantes',
  h1: 'Organiza mesas, comandas y cobro de tu restaurante',
  intro:
    'En un restaurante, un pedido pasa por tres manos: quien atiende la mesa, quien cocina y quien cobra. Vendix conecta ese recorrido: el mesero abre la mesa y toma el pedido, la cocina lo ve en su pantalla con las notas, y la caja cobra la cuenta completa o dividida. Si trabajas con recetas, los insumos se descuentan cuando el plato sale a cocina.',
  steps: [
    {
      title: 'Abres la mesa',
      text: 'Eliges la mesa en el mapa del salón, indicas cuántos comensales hay y, si quieres, a qué cliente pertenece la cuenta. La mesa pasa a ocupada.',
      evidence: DEMO_11_NOV + ' §1 paso 1',
    },
    {
      title: 'Tomas el pedido',
      text: 'Agregas platos y bebidas, y escribes la nota para cocina: «sin cebolla», «término medio».',
      evidence: DEMO_11_NOV + ' §1 paso 2',
    },
    {
      title: 'Lo envías a cocina',
      text: 'Antes de enviarlo ves la receta del plato y puedes desmarcar los ingredientes que el cliente no quiere; esos no se descuentan del inventario.',
      evidence: DEMO_11_NOV + ' §1 pasos 3 y 3b',
    },
    {
      title: 'La cocina lo ve en pantalla',
      text: 'El ticket llega con la mesa, los platos y las notas, a la estación que corresponde: los platos a la cocina y las bebidas a la barra. El cocinero lo pasa a En preparación y a Listo.',
      evidence: DEMO_11_NOV + ' §1 pasos 4 y 5',
    },
    {
      title: 'Llevas los platos a la mesa',
      text: 'El mesero o la caja los marca como entregados desde la cuenta de la mesa.',
      evidence: DEMO_11_NOV + ' §1 pasos 6 y 8',
    },
    {
      title: 'Cobras la cuenta',
      text: 'Completa o dividida —en partes iguales, por montos o por productos— y cada parte con el medio de pago que prefiera cada persona.',
      evidence: DEMO_11_NOV + ' §1 pasos 9 a 11',
    },
    {
      title: 'Cierras la mesa',
      text: 'Queda en limpieza hasta que la marques disponible para los siguientes clientes.',
      evidence: DEMO_11_NOV + ' §1 pasos 12 y 13',
    },
  ],
  sections: [
    {
      id: 'servicio',
      heading: 'Cambios en el servicio',
      bullets: [
        {
          text: 'Cancelar un plato: Vendix pide el motivo y la cancelación se refleja en la cuenta y en la cocina.',
          evidence: DEMO_13_OCT + '; apps/backend/src/domains/store/tables/dto/cancel-order-item.dto.ts',
        },
        {
          text: 'Agregar más platos: sigues agregando a la misma cuenta y envías a cocina solo lo nuevo.',
          evidence: DEMO_11_NOV + ' §1 (envío por plato)',
        },
      ],
    },
    {
      id: 'cocina',
      heading: 'Tu cocina, como trabaja hoy',
      bullets: [
        {
          text: 'Con pantalla: la cocina usa un computador, una tablet o un televisor con navegador y ve los pedidos en orden.',
          evidence: DEMO_11_NOV + ' §1 paso 5',
        },
        {
          text: 'Por estaciones: si tienes barra y cocina, cada estación ve solo lo suyo.',
          evidence: DEMO_11_NOV + ' §1 paso 4',
        },
      ],
    },
    {
      id: 'insumos',
      heading: 'Recetas e insumos',
      paragraphs: [
        {
          text: 'Si cargas la receta de cada plato, Vendix descuenta los insumos cuando el plato sale a cocina, no cuando se cobra. Así ves cuánto te queda de cada ingrediente.',
          evidence: DEMO_11_NOV + ' §1 paso 3',
        },
        {
          text: 'Por defecto, si un ingrediente se acaba, Vendix te avisa pero deja enviar el plato; el inventario de ese insumo puede quedar en negativo hasta que registres la compra. Si prefieres que no se pueda enviar un plato sin insumos, puedes activar ese bloqueo en la configuración.',
          evidence: DEMO_11_NOV + ' §1 paso 3 (aviso); apps/backend/src/domains/store/settings/defaults/default-store-settings.ts (allow_ingredient_overuse)',
        },
      ],
    },
  ],
  limits: [
    { text: 'Necesitas internet en la caja, en el salón y en la cocina.', evidence: 'claims-register C06' },
    {
      text: 'No une mesas: puedes trasladar o intercambiar cuentas entre mesas, pero no juntar dos cuentas en una.',
      evidence: 'apps/backend/src/domains/store/orders/shared/order-table-reassignment-policy.util.ts',
    },
    { text: 'No se conecta con apps de domicilios ni con agregadores.', evidence: 'Búsqueda en código sin integraciones' },
    { text: 'La nota de cocina no reemplaza tu protocolo de alergias.', evidence: 'Regla editorial' },
    {
      text: 'La facturación electrónica es de los planes Empresarial Pro e IA Business, y el tiempo de habilitación lo pone la DIAN.',
      evidence: 'OPS-32-D10 §1, §5; claims-register C09, C10',
    },
    {
      text: 'Las funciones de restaurante aparecen cuando tu tienda tiene la industria Restaurante.',
      evidence: 'apps/frontend/src/app/shared/constants/industry-modules.constant.ts',
    },
  ],
  prepare: [
    'Tu carta con precios y, si quieres controlar insumos, la receta de dos o tres platos.',
    'El número de mesas y cómo las nombras.',
    'Quién toma pedidos, quién cocina y quién cobra.',
    'Si tienes estaciones separadas, por ejemplo barra y cocina.',
  ],
  faqs: [
    {
      question: '¿Puedo dividir la cuenta?',
      text: 'Sí. En partes iguales, por montos o por productos, y cobras cada parte por separado, con el medio de pago que prefiera cada persona.',
      evidence: DEMO_11_NOV + ' §1 pasos 9 a 11',
    },
    {
      question: '¿Se descuentan los ingredientes del inventario?',
      text: 'Sí, si el plato tiene receta. Se descuentan cuando el plato sale a cocina, y puedes excluir los que el cliente no quiere.',
      evidence: DEMO_11_NOV + ' §1 pasos 3 y 3b',
    },
    {
      question: '¿Necesito cargar recetas para usar la pantalla de cocina?',
      text: 'Para iniciar la preparación de un plato en la pantalla de cocina, el plato necesita su receta. Sin receta, la cocina ve el pedido, pero no puede iniciarlo.',
      evidence: 'apps/frontend/src/app/private/modules/store/restaurant-ops/kds/components/kds-ticket-card/kds-ticket-card.component.html',
    },
    { question: '¿Se conecta con Rappi u otras apps de domicilio?', text: 'No.', evidence: 'Búsqueda en código sin integraciones' },
    {
      question: '¿Cuánto cuesta?',
      text: 'Todos los planes incluyen las funciones de restaurante. Mira los planes y precios.',
      evidence: 'product-truth 2026-10-21 (restaurante = Disponible)',
    },
  ],
  whatsappText: 'Hola, tengo un restaurante y quiero ver la demo de mesa a cobro.',
};

const DEMO_13_OCT_POS = 'Demos 13 y 14-oct-2026 (seguimiento: evidencias/cupon-valido-demo-2026-10-13, cupon-invalido-revalidacion-2026-10-14, tarifa-cafe-demo-2026-10-13, promocion-producto-demo-2026-10-13)';

/**
 * SEO-OPS-15: página de POS para comercios. Texto del borrador v2 (27-oct) recortado a lo
 * comprobado: la demo del 11-nov (§2: caja, variante, cambio, salida, cierre) y las del 13/14-oct
 * (cupón, tarifa, promoción). Fuera hasta tener demo: cobro repartido en varios medios,
 * descuento de inventario por venta POS, devoluciones, lector de código de barras (C12) y
 * documento POS electrónico (C08).
 */
const SOFTWARE_POS: SectorPageContent = {
  path: 'soluciones/software-pos',
  metadata: {
    title: 'Software POS para comercios en Colombia | Vendix',
    description:
      'Vende desde el navegador, aplica cupones y precios especiales, y cuadra tu caja al cerrar el turno. Mira cómo funciona el POS de Vendix y sus límites.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  label: 'Punto de venta',
  h1: 'Vende, cobra y cierra tu caja desde el navegador',
  intro:
    'Vendix es un punto de venta en la nube para comercios de mostrador en Colombia. Abres el navegador en tu computador o tablet, buscas el producto, cobras y, al final del turno, cuadras la caja. Los precios, las ventas y el cierre de caja quedan en el mismo sistema.',
  stepsHeading: 'Así va una venta, de la apertura al cierre',
  steps: [
    {
      title: 'Abres la caja',
      text: 'Eliges la caja y escribes el efectivo con el que empiezas el turno. Si otra persona ya tiene esa caja abierta, aparece como «En uso».',
      evidence: DEMO_11_NOV + ' §2 C1',
    },
    {
      title: 'Agregas los productos',
      text: 'Buscas por nombre o código. Si el producto tiene variantes, como sabor o talla, la caja te pide cuál se lleva el cliente.',
      evidence: DEMO_11_NOV + ' §2 C2 y C3',
    },
    {
      title: 'Aplicas el beneficio que corresponda',
      text: 'Un precio especial para el cliente, un cupón o una promoción de ciertos productos. Si el cupón no existe o está vencido, Vendix lo rechaza y el total no cambia.',
      evidence: DEMO_13_OCT_POS,
    },
    {
      title: 'Cobras',
      text: 'En efectivo, datáfono o transferencia, según los medios que tengas habilitados. Con efectivo, escribes lo que te entregan y la caja te muestra el cambio.',
      evidence: DEMO_11_NOV + ' §2 C4',
    },
    {
      title: 'Registras los movimientos de efectivo',
      text: 'Si sacas dinero de la caja para un pago, lo registras como salida, con el monto y el motivo.',
      evidence: DEMO_11_NOV + ' §2 C5',
    },
    {
      title: 'Cierras la caja',
      text: 'Escribes el efectivo que contaste. Vendix suma la base y las ventas en efectivo, resta las salidas y te muestra si sobra o falta.',
      evidence: DEMO_11_NOV + ' §2 C6 y C7',
    },
  ],
  sections: [
    {
      id: 'cierre',
      heading: 'Un cierre de caja que puedes revisar',
      paragraphs: [
        {
          text: 'En el detalle del turno ves cómo se llega al efectivo esperado: base de apertura, más ventas en efectivo, menos retiros. Las ventas con datáfono o transferencia aparecen aparte, porque no están en el cajón.',
          evidence: DEMO_11_NOV + ' §2 C6',
        },
        {
          text: 'Si al cerrar queda una venta pendiente de cobro, Vendix te avisa antes de cerrar, y ese dinero no se suma al efectivo esperado.',
          evidence: DEMO_11_NOV + ' §2 C7',
        },
      ],
    },
    {
      id: 'empezar',
      heading: 'Qué necesitas para empezar',
      bullets: [
        { text: 'Un computador o tablet con navegador y conexión a internet.', evidence: 'claims-register C06' },
        {
          text: 'Una impresora instalada en tu equipo, si quieres comprobante en papel: Vendix imprime con el diálogo de impresión del navegador.',
          evidence: 'apps/frontend/src/app/shared/services/print/document-print.service.ts; claims-register C11',
        },
        {
          text: 'Tu catálogo: lo creas producto por producto o lo importas desde Excel o CSV con la plantilla de Vendix.',
          evidence: 'Importación probada por Adel el 11-nov; claims-register C24',
        },
      ],
    },
  ],
  limits: [
    { text: 'No funciona sin internet: si se cae la conexión, no puedes registrar ventas hasta que vuelva.', evidence: 'claims-register C06; pos-offline.service.ts no se inyecta' },
    { text: 'No lee códigos con la cámara del celular.', evidence: 'Búsqueda en apps/frontend sin BarcodeDetector, zxing ni quagga' },
    {
      text: 'No envía comandos directos a impresoras térmicas: imprime por el navegador, así que depende de que tu impresora esté instalada en el equipo.',
      evidence: 'pos-ticket.service.ts y document-print.service.ts sin ESC/POS; claims-register C11',
    },
    {
      text: 'La facturación electrónica es de los planes Empresarial Pro e IA Business, y el tiempo de habilitación lo pone la DIAN.',
      evidence: 'OPS-32-D10 §1, §5; claims-register C09, C10',
    },
  ],
  prepare: [
    'Una lista corta de productos con precio, y si tienes variantes, una de ellas.',
    'Los medios de pago que recibes hoy.',
    'Cuántas cajas y cajeros tienes.',
    'Cómo haces hoy el cierre de caja.',
  ],
  faqs: [
    {
      question: '¿Necesito instalar algo?',
      text: 'No. Entras desde el navegador. Lo que sí necesitas es conexión a internet mientras vendes.',
      evidence: 'claims-register C06',
    },
    {
      question: '¿Qué impresora sirve?',
      text: 'Una que tu computador o tablet reconozca, porque Vendix imprime con el diálogo de impresión del navegador. Pruébala con tu equipo antes de decidir.',
      evidence: 'claims-register C11',
    },
    {
      question: '¿Varias personas pueden vender al mismo tiempo?',
      text: 'Sí, cada una con su usuario y su caja abierta. Una caja no puede tener dos turnos abiertos a la vez.',
      evidence: DEMO_11_NOV + ' §2 C1 (cajas «En uso»); sessions.service.ts',
    },
    {
      question: '¿Cobran comisión por venta?',
      text: 'No. Pagas tu plan; Vendix no cobra un porcentaje de lo que vendes.',
      evidence: 'claims-register C22',
    },
    {
      question: '¿Hay permanencia?',
      text: 'No. Puedes cancelar cuando quieras.',
      evidence: 'Decisión comercial del 10-nov-2026 (Adel); /pricing «Antes de elegir tu plan»',
    },
  ],
  whatsappText: 'Hola, tengo un comercio y quiero ver la demo del punto de venta.',
};

export const SECTOR_PAGES: readonly SectorPageContent[] = [RESTAURANTES, SOFTWARE_POS];

export function sectorPageByPath(path: string): SectorPageContent | null {
  return SECTOR_PAGES.find((page) => page.path === path) ?? null;
}

/** WhatsApp de ventas (respuesta 17 del 22-oct). */
export function sectorWhatsappUrl(page: SectorPageContent): string {
  return 'https://wa.me/573234668500?text=' + encodeURIComponent(page.whatsappText);
}
