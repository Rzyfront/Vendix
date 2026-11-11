import { environment } from '../../../environments/environment';
import { MarketingPageMetadata } from '../marketing-page-metadata';

/**
 * Plantilla de páginas de sector y solución de la web comercial (SEO-TECH-08, SEO-OPS-17).
 *
 * Cada página es un registro de datos: el componente no tiene texto propio. Reglas
 * (registro editorial y claims-register):
 * - Solo se escribe lo que tiene evidencia (`evidence`): demo en pantalla o código.
 *   Lo que todavía no tiene demo no entra (propina, QR de mesa, comanda impresa…).
 * - Todas van en `noindex` y sin canonical hasta la firma de Producto y Ventas (G4).
 * - Las rutas solo existen con el interruptor `sectorPagesEnabled` (apagado en producción).
 */
export const SECTOR_PAGES_ENABLED = environment.sectorPagesEnabled;

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

export const SECTOR_PAGES: readonly SectorPageContent[] = [RESTAURANTES];

export function sectorPageByPath(path: string): SectorPageContent | null {
  return SECTOR_PAGES.find((page) => page.path === path) ?? null;
}

/** WhatsApp de ventas (respuesta 17 del 22-oct). */
export function sectorWhatsappUrl(page: SectorPageContent): string {
  return 'https://wa.me/573234668500?text=' + encodeURIComponent(page.whatsappText);
}
