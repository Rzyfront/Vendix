import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef,
  PLATFORM_ID,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { CommonModule, DecimalPipe } from '@angular/common';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { isPlatformBrowser } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ModalComponent } from '../../../shared/components/modal/modal.component';
import type { IconName } from '../../../shared/components/icon/icons.registry';
import { markdownToHtml } from '../../../shared/utils/markdown.util';
import {
  buildFeatureComparison,
  normalizeIncludedItems,
} from '../../../shared/utils/plan-features.util';
import { HeroLiveDashboardComponent } from './components/hero-live-dashboard/hero-live-dashboard.component';
import {
  VexiAvatarComponent,
  type VexiExpression,
} from '../../../shared/components/vexi-dock/vexi-avatar.component';
import { VexiToolTraceComponent } from '../../../shared/components/vexi-dock/vexi-tool-trace.component';
import type { ToolStep } from '../../../core/store/vexi/vexi.actions';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import {
  PublicPlansService,
  PublicPlan,
} from '../../pricing/services/public-plans.service';
import {
  StoreIndustry,
  STORE_INDUSTRIES,
  INDUSTRY_METADATA,
} from '../../../shared/constants/industry-modules.constant';

export interface IndustryFeatureItem {
  icon: string;
  title: string;
  desc: string;
}

/**
 * Sectores que se muestran en la landing. `beauty` NO existe en el
 * `industry_enum` del backend: la industria real es `service`, y aquí se parte
 * en dos pestañas porque el discurso de un salón y el de una consultoría no se
 * parecen en nada. Es una división de marketing, no de dominio.
 */
export type LandingSector = StoreIndustry | 'beauty';

/**
 * Ventana del simulador del hero, gobernada por el semáforo macOS de su barra.
 * `closing`/`minimizing` son estados de tránsito: la ventana sigue en el DOM
 * mientras corre la animación de salida y sólo después pasa a `closed` /
 * `minimized`, donde la sustituye el icono de «Vendix app».
 */
export type HeroWindowState = 'open' | 'closing' | 'closed' | 'minimizing' | 'minimized';
/** Animación de entrada en curso al volver a abrir la ventana. */
export type HeroWindowEnter = 'opening' | 'restoring' | null;

export interface IndustryPresentation {
  value: LandingSector;
  title: string;
  tag: string;
  headline: string;
  description: string;
  feature1: IndustryFeatureItem;
  feature2: IndustryFeatureItem;
  /**
   * Ruta base de la foto de la industria, SIN extensión. El template arma un
   * <picture> con `.webp` (≈100 KB) y deja el `.png` original (≈2 MB) como
   * respaldo para el navegador que no entienda WebP.
   */
  image: string;
}

export interface VexiMessage {
  role: 'user' | 'assistant';
  text: string;
  time: string;
  alert?: boolean;
  actionText?: string;
  completed?: boolean;
}

/** Fase del simulador de Vexi: replica el ciclo pregunta → «pensando» → respuesta del panel real. */
export type VexiDemoPhase = 'empty' | 'typing' | 'answered';
export type VexiDemoDecision = 'pending' | 'approved' | 'rejected';

export interface VexiDemoExample {
  id: number;
  /** Título corto: cajón de conversaciones del panel. */
  title: string;
  /** Lo que «escribe» la persona: burbuja de usuario y chip del estado vacío. */
  question: string;
  /** Explicación de la tarjeta en la columna izquierda. */
  blurb: string;
  icon: IconName;
  /** Traza que muestra el componente real app-vexi-tool-trace (ya en estado done). */
  steps: ToolStep[];
  /** Frase de progreso mientras Vexi «piensa», como progressPhrase() del panel real. */
  phrase: string;
}

// Tiempos del simulador. Cortos a propósito: la demo tiene que sentirse viva,
// no hacer esperar. Con prefers-reduced-motion se saltan.
const VEXI_THINK_MS = 900;
const VEXI_APPLY_MS = 700;

const VEXI_EXAMPLES: VexiDemoExample[] = [
  {
    id: 1,
    title: 'Producto menos rentable',
    question: '¿Cuál es mi producto menos rentable?',
    blurb:
      'Detecta márgenes críticos (ej. Huawei Watch GT 40 con 10,71%), calcula ganancia neta en pesos y evalúa el contexto general de tu catálogo.',
    icon: 'trending-down',
    phrase: 'Cruzo ventas, costos y márgenes…',
    steps: [
      { id: '1a', name: 'get_sales_report', status: 'done', summary: 'Ventas del mes · 38 referencias' },
      { id: '1b', name: 'get_product_pricing', status: 'done', summary: 'Huawei Watch GT 40 · costo vs. precio' },
    ],
  },
  {
    id: 2,
    title: 'Producto menos vendido',
    question: '¿Cuál es el producto que menos vendo?',
    blurb:
      'Identifica bajas rotaciones y empates de ventas críticas (Airpods 3, Xiaomi 13 Lite, Tecno Camon 20) para evitar inventario dormido.',
    icon: 'search',
    phrase: 'Ordeno tus ventas por unidades…',
    steps: [
      { id: '2a', name: 'get_sales_report', status: 'done', summary: 'Unidades por referencia · este mes' },
      { id: '2b', name: 'list_products', status: 'done', summary: 'Catálogo activo · 38 referencias' },
    ],
  },
  {
    id: 3,
    title: 'Ingresar factura de proveedor',
    question: 'Vexi, ingresa esta factura de mi proveedor',
    blurb:
      'Escaneo OCR inteligente de compras por foto o PDF: extrae NIT, ítems, IVA y actualiza tu stock sin digitar nada a mano.',
    icon: 'scan-line',
    phrase: 'Leo la factura y detecto NIT, ítems e IVA…',
    steps: [
      { id: '3a', name: 'get_stock_levels', status: 'done', summary: '3 referencias de Distribuciones Colanta' },
      { id: '3b', name: 'get_inventory_locations', status: 'done', summary: 'Bodega principal' },
    ],
  },
  {
    id: 4,
    title: 'Alerta de stock bajo',
    question: 'Vexi, avísame si el stock baja de 10 unidades',
    blurb:
      'Alertas preventivas a WhatsApp con borrador de orden de compra listo para enviar a tus distribuidores.',
    icon: 'bell-ring',
    phrase: 'Reviso tus niveles de stock…',
    steps: [
      { id: '4a', name: 'get_low_stock_alerts', status: 'done', summary: '2 referencias bajo el mínimo' },
      { id: '4b', name: 'get_stock_levels', status: 'done', summary: 'Café Especial Huila 500g · 3 unidades' },
    ],
  },
];

/** Traza que aparece cuando se aprueba el registro de la factura. */
const VEXI_OCR_APPLIED_STEPS: ToolStep[] = [
  { id: '3c', name: 'create_stock_adjustment', status: 'done', summary: '+120 unidades · Bodega principal' },
];

// Mínimo comercial publicado: sólo se usa si la API de planes no respondió.
const MIN_MONTHLY_PRICE_COP = 49_900;

/** Meses que cubre cada ciclo: `base_price` de la API es el TOTAL del período. */
const CYCLE_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
  yearly: 12,
};

/** Celda de la tabla comparativa: texto + tono visual. */
export interface ComparisonCell {
  text: string;
  tone: 'yes' | 'partial' | 'no';
}
export interface ComparisonRow {
  label: string;
  cells: ComparisonCell[];
}

const yes = (text: string): ComparisonCell => ({ text, tone: 'yes' });
const partial = (text: string): ComparisonCell => ({ text, tone: 'partial' });
const no = (): ComparisonCell => ({ text: '—', tone: 'no' });

/**
 * Los 4 planes base vigentes en producción, en el orden de la tabla. Los
 * nombres son los que publica GET /api/public/plans; los precios NO van aquí
 * (la tabla no los muestra) sino en las cards, que los leen de la API.
 */
const COMPARISON_PLANS = ['Vendix Impulsa', 'Emprendedor', 'Empresarial Pro', 'IA Business'] as const;
/** Columna resaltada: Emprendedor, el `is_popular` de la API. */
const COMPARISON_HIGHLIGHT_INDEX = 1;

const COMPARISON_ROWS: ComparisonRow[] = [
  { label: 'Usuarios del equipo', cells: [partial('1 usuario'), yes('Ilimitados'), yes('Ilimitados'), yes('Ilimitados')] },
  { label: 'Industrias y flujos por sector', cells: [partial('1 industria'), yes('Ilimitadas y combinadas'), yes('Ilimitadas y combinadas'), yes('Ilimitadas y combinadas')] },
  { label: 'Productos, catálogo y POS', cells: [yes('Ilimitados'), yes('Ilimitados'), yes('Ilimitados'), yes('Ilimitados')] },
  { label: 'Tienda online y catálogo WhatsApp', cells: [yes('Incluida'), yes('Incluida'), yes('Incluida'), yes('Incluida')] },
  { label: 'Inventario, compras y reportes', cells: [yes('Ilimitados'), yes('Ilimitados'), yes('Ilimitados'), yes('Ilimitados')] },
  { label: 'Comisión por venta realizada', cells: [yes('0%'), yes('0%'), yes('0%'), yes('0%')] },
  { label: 'Facturación Electrónica DIAN', cells: [no(), no(), yes('Incluida'), yes('Incluida')] },
  { label: 'Nómina Electrónica', cells: [no(), no(), yes('Incluida'), yes('Incluida')] },
  { label: 'Documento Soporte', cells: [no(), no(), yes('Incluido'), yes('Incluido')] },
  { label: 'Contabilidad automatizada', cells: [no(), no(), yes('Incluida'), yes('Incluida')] },
  { label: 'Vexi IA (consultas, OCR y documentos)', cells: [partial('Límites de prueba'), yes('Límites extendidos'), yes('Límites extendidos'), yes('×100 vs. Impulsa')] },
  { label: 'IA Tools e IA Agents en todos los procesos', cells: [no(), no(), no(), yes('Incluidos')] },
];

/**
 * Tope de ítems que caben en una card sin desbordar la retícula de 4 columnas.
 * Lo que sobra vive en el modal «Ver todo lo que incluye».
 */
const CARD_FEATURE_LIMIT = 7;

// Cada sector se muestra 10s antes de pasar al siguiente.
const SECTOR_ROTATION_MS = 10_000;

// Duraciones de la ventana del simulador. Espejo exacto de las animaciones
// `heroWindow*` del SCSS: el estado final se fija por temporizador, no por
// `animationend`, para que la ventana no quede a medio cerrar si la animación
// nunca corre (prefers-reduced-motion, pestaña en segundo plano).
const HERO_CLOSE_MS = 240;
const HERO_MINIMIZE_MS = 420;
const HERO_OPEN_MS = 360;
const HERO_RESTORE_MS = 420;
/** Alto de reserva del escenario si aún no se pudo medir la ventana. */
const HERO_STAGE_FALLBACK_PX = 360;

// Demo en vídeo. Se usa el dominio -nocookie y sólo se toca al pulsar play.
const DEMO_VIDEO_ID = 'hQRz9mJURwM';
const DEMO_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://i.ytimg.com',
  'https://fonts.gstatic.com',
];

@Component({
  selector: 'app-vendix-landing',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    ModalComponent,
    DecimalPipe,
    HeroLiveDashboardComponent,
    VexiAvatarComponent,
    VexiToolTraceComponent,
  ],
  templateUrl: './vendix-landing.component.html',
  styleUrls: ['./vendix-landing.component.scss'],
})
export class VendixLandingComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly sanitizer = inject(DomSanitizer);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private publicPlansService = inject(PublicPlansService);
  private tenantFacade = inject(TenantFacade);

  // State Signals (Zoneless compliant)
  readonly tenantConfig = signal<any>(null);
  readonly mobileMenuOpen = signal<boolean>(false);
  readonly showDemoModal = signal<boolean>(false);
  // El iframe de YouTube sólo existe mientras esto sea true.
  readonly demoPlaying = signal<boolean>(false);
  private readonly demoThumbFallback = signal<boolean>(false);
  private demoWarmed = false;

  // ── Ventana del simulador (semáforo macOS) ─────────────────
  readonly heroWindow = signal<HeroWindowState>('open');
  readonly heroEnter = signal<HeroWindowEnter>(null);
  readonly heroFullscreen = signal<boolean>(false);
  /** Alto de la ventana medido justo antes de cerrarla o de pasarla a pantalla
   *  completa: el escenario lo hereda para que la landing no salte. */
  private readonly heroStageHeight = signal<number | null>(null);
  private heroTimer: ReturnType<typeof setTimeout> | null = null;

  readonly heroWindowVisible = computed(() => {
    const state = this.heroWindow();
    return state !== 'closed' && state !== 'minimized';
  });
  readonly heroStageMinHeight = computed(() =>
    this.heroFullscreen() || !this.heroWindowVisible()
      ? (this.heroStageHeight() ?? HERO_STAGE_FALLBACK_PX)
      : null,
  );

  // Plans & Pricing Signals
  readonly comparisonPlans = COMPARISON_PLANS;
  readonly comparisonRows = COMPARISON_ROWS;
  readonly comparisonHighlightIndex = COMPARISON_HIGHLIGHT_INDEX;

  readonly plans = signal<PublicPlan[]>([]);
  readonly loadingPlans = signal<boolean>(true);
  readonly plansError = signal<boolean>(false);
  readonly selectedCycle = signal<string>('annual');
  readonly selectedCurrency = signal<'COP' | 'USD'>('COP');

  // Industry Selector Signal
  readonly selectedIndustry = signal<LandingSector>('retail');

  // ROI Calculator Signals
  readonly storeCount = signal<number>(2);
  readonly invoicesCount = signal<number>(7200);

  // FAQ Accordion Signal
  readonly openFaqId = signal<number | null>(1);

  // Vexi: simulador que replica el panel flotante real (app-vexi-panel).
  readonly vexiExamples = VEXI_EXAMPLES;
  readonly vexiOcrAppliedSteps = VEXI_OCR_APPLIED_STEPS;
  readonly activeVexiTab = signal<number>(1);
  readonly vexiPhase = signal<VexiDemoPhase>('answered');
  readonly vexiPanelOpen = signal<boolean>(true);
  readonly vexiSidebarOpen = signal<boolean>(false);
  readonly vexiVoiceUi = signal<boolean>(false);
  readonly vexiVoiceRecording = signal<boolean>(false);
  readonly vexiDecision = signal<VexiDemoDecision>('pending');
  readonly vexiApplying = signal<boolean>(false);
  /** Pregunta libre escrita en el composer cuando no coincide con ningún ejemplo. */
  readonly vexiCustomQuestion = signal<string>('');
  readonly vexiQuery = signal<string>('');
  /** Alto del panel al cerrarlo: el escenario lo conserva para que la sección no salte. */
  readonly vexiStageHeight = signal<number | null>(null);
  private vexiTimer: ReturnType<typeof setTimeout> | null = null;

  readonly activeVexiExample = computed(
    () => this.vexiExamples.find((example) => example.id === this.activeVexiTab()) ?? null,
  );
  readonly vexiQuestion = computed(
    () => this.activeVexiExample()?.question ?? this.vexiCustomQuestion(),
  );
  readonly vexiProposalPending = computed(
    () =>
      this.vexiPhase() === 'answered' &&
      this.vexiDecision() === 'pending' &&
      (this.activeVexiTab() === 3 || this.activeVexiTab() === 4),
  );
  // Mismos textos que statusLine() del panel real.
  readonly vexiStatusLine = computed(() => {
    if (this.vexiPhase() === 'typing') return 'Pensando…';
    if (this.vexiApplying()) return 'Aplicando…';
    if (this.vexiProposalPending()) return 'Esperando tu confirmación';
    return 'Tu copiloto de tienda';
  });
  readonly vexiExpression = computed<VexiExpression>(() => {
    if (this.vexiPhase() === 'typing') return 'thinking';
    if (this.vexiVoiceRecording()) return 'excited';
    if (this.vexiProposalPending()) return 'wow';
    if (this.vexiDecision() === 'approved') return 'happy';
    return 'idle';
  });
  readonly vexiProgressPhrase = computed(
    () => this.activeVexiExample()?.phrase ?? 'Reviso tu información…',
  );
  readonly vexiVoiceStatus = computed(() => {
    if (this.vexiVoiceRecording()) return 'Te escucho…';
    if (this.vexiPhase() === 'typing') return 'Pensando…';
    return 'Mantén presionado el micrófono y pregúntame';
  });
  readonly vexiVoiceHint = computed(() =>
    this.vexiVoiceRecording() ? 'Suelta para enviar' : 'Mantén presionado para hablar',
  );
  readonly vexiChatMessages = signal<VexiMessage[]>([
    {
      role: 'user',
      text: '¿Cómo va la utilidad neta de hoy y qué producto debemos reponer ya?',
      time: '16:44',
    },
    {
      role: 'assistant',
      text: '📊 Diagnóstico en Vivo (16:45 PM): Tu venta bruta hoy es de $3.842.500 COP con una utilidad neta estimada de $1.290.400 (33.6%).',
      time: '16:45',
      alert: true,
      actionText: 'Enviar orden de reposición (24 unids) a Colanta por WhatsApp',
      completed: false,
    },
  ]);

  // Real Social Links & Official Channels
  readonly socialLinks = {
    instagram: 'https://www.instagram.com/vendix.online/',
    tiktok: 'https://www.tiktok.com/@vendix.online',
    facebook: 'https://www.facebook.com/share/1B1fq8BbXD/',
    whatsapp: 'https://wa.me/573234668500',
    email: 'soporte@vendix.online',
    domain: 'vendix.online',
  };

  // 6 Real Industry Presentations mapped from Vendix source of truth
  readonly industryData: Record<LandingSector, IndustryPresentation> = {
    retail: {
      value: 'retail',
      title: 'Retail & Mostrador',
      tag: 'COMERCIO MINORISTA & SUPERMERCADOS',
      headline: 'Cobros en menos de 5 segundos y control anti-mermas',
      description:
        'Optimizado para la velocidad del mostrador: lectura de códigos de barra ultra-rápida, control de existencias mínimas con reposición automática y libreta de créditos/fiados a clientes recurrentes.',
      feature1: {
        icon: 'barcode',
        title: 'Lector Ultra-rápido',
        desc: 'Compatible con lectores USB, Bluetooth y escaneo con cámara de celular.',
      },
      feature2: {
        icon: 'credit-card',
        title: 'Crédito de Clientes',
        desc: 'Gestión de cartera, abonos, recibos y cupos de fiado integrados en caja.',
      },
      image: 'assets/images/industries/retail',
    },
    restaurant: {
      value: 'restaurant',
      title: 'Restaurantes & Gastronomía',
      tag: 'GASTRONOMÍA, BARES & CAFÉS',
      headline: 'Comandero de cocina, mapa de mesas y costeo de recetas',
      description:
        'Elimina los gritos y los papeles perdidos. Envía pedidos directamente a la pantalla de cocina (KDS), controla el estado de las mesas en tiempo real y descuenta gramo a gramo los ingredientes con costeo FIFO.',
      feature1: {
        icon: 'flame',
        title: 'Pantalla KDS Cocina',
        desc: 'Tiempos de preparación, semáforo de urgencia y alertas de retraso por plato.',
      },
      feature2: {
        icon: 'store',
        title: 'División de Cuentas',
        desc: 'Divide la comanda por comensal, mesa o pagos mixtos en segundos.',
      },
      image: 'assets/images/industries/restaurant',
    },
    gym: {
      value: 'gym',
      title: 'Gimnasios & Centros Deportivos',
      tag: 'GIMNASIOS, FITNESS & BIENESTAR',
      headline: 'Membresías periódicas, torniquetes y venta en recepción',
      description:
        'Controla planes mensuales, trimestrales o anuales con cobro recurrente. Monitorea aforo y control de acceso con huella o código QR, integrando la venta de suplementos e hidratación en el mismo POS.',
      feature1: {
        icon: 'check-circle',
        title: 'Control de Acceso',
        desc: 'Validación instantánea del estado de pago de cada socio al ingresar.',
      },
      feature2: {
        icon: 'refresh-cw',
        title: 'Cobro Recurrente',
        desc: 'Renovación automática con recordatorios directos por WhatsApp.',
      },
      image: 'assets/images/industries/gym',
    },
    service: {
      value: 'service',
      title: 'Consultoría & Servicios Profesionales',
      tag: 'SERVICIOS PROFESIONALES & CONSULTORÍA',
      headline: 'Cotizaciones, horas facturables y cuentas de cobro DIAN',
      description:
        'Convierte presupuestos y propuestas en facturas electrónicas en 1 solo clic. Registra honorarios por proyecto, controla anticipos de clientes y maneja retenciones de renta e ICA de manera automatizada.',
      feature1: {
        icon: 'file-text',
        title: 'Cotización a Factura',
        desc: 'Aprobación digital con firma del cliente y emisión tributaria inmediata.',
      },
      feature2: {
        icon: 'clock',
        title: 'Control de Anticipos',
        desc: 'Conciliación de saldos pendientes y pagos parciales por hito de servicio.',
      },
      image: 'assets/images/industries/consultoria',
    },
    beauty: {
      value: 'beauty',
      title: 'Salones de Belleza & Barberías',
      tag: 'SALONES, BARBERÍAS & SPA',
      headline: 'Agenda por profesional, comisiones y venta de producto',
      description:
        'Reserva citas por estilista con la duración real de cada servicio, cobra servicio y producto en la misma cuenta y liquida la comisión de cada profesional sin cuadrar nada a mano. Los recordatorios por WhatsApp evitan que la silla quede vacía.',
      feature1: {
        icon: 'calendar-check',
        title: 'Agenda por Silla',
        desc: 'Citas por profesional con duración, tiempo de preparación y recordatorio automático al cliente.',
      },
      feature2: {
        icon: 'percent',
        title: 'Comisión por Estilista',
        desc: 'Liquidación automática por servicio vendido, lista para pasar a nómina.',
      },
      image: 'assets/images/industries/services',
    },
    manufacturing: {
      value: 'manufacturing',
      title: 'Manufactura & Producción',
      tag: 'MANUFACTURA & TALLERES DE PRODUCCIÓN',
      headline: 'Fórmulas de producción, órdenes de taller y costeo real',
      description:
        'Calcula con precisión el costo unitario de fabricación sumando materia prima, mano de obra e insumos. Genera órdenes de producción con descuento automático de inventario por etapa productiva.',
      feature1: {
        icon: 'boxes',
        title: 'Fórmulas & Recetas de Producción',
        desc: 'Cada ensamble descuenta su materia prima automáticamente al fabricarse.',
      },
      feature2: {
        icon: 'trending-up',
        title: 'Costeo Estándar vs Real',
        desc: 'Detección inmediata de desviaciones de costo y mermas en planta.',
      },
      image: 'assets/images/industries/manufactura',
    },
    construction: {
      value: 'construction',
      title: 'Contratistas & Construcción',
      tag: 'CONTRATISTAS, OBRAS & CONSTRUCTORAS',
      headline: 'Actas de entrega, facturación AIU y remisiones en campo',
      description:
        'Soporte nativo para facturación electrónica con fórmula AIU (Administración, Imprevistos y Utilidad). Registra salidas de materiales hacia frentes de obra y emite actas de avance con aprobación desde el celular.',
      feature1: {
        icon: 'building-2',
        title: 'Facturación con AIU',
        desc: 'Desglose tributario automático con base gravable especial aprobada por la DIAN.',
      },
      feature2: {
        icon: 'truck',
        title: 'Remisiones en Obra',
        desc: 'Envío y recepción de insumos con control de despachos y firma en pantalla.',
      },
      image: 'assets/images/industries/obra',
    },
  };

  readonly industriesList = STORE_INDUSTRIES;

  /**
   * Pestañas del bloque de sectores, en orden de rotación. Los íconos salen
   * todos de `icons.registry`: uno sin registrar cae en `default` (HelpCircle)
   * y se pinta como un círculo con interrogación.
   */
  readonly sectorTabs: ReadonlyArray<{
    value: LandingSector;
    label: string;
    icon: IconName;
  }> = [
    { value: 'retail', label: 'Retail & Mostrador', icon: 'store' },
    { value: 'restaurant', label: 'Restaurantes & Gastronomía', icon: 'utensils' },
    { value: 'gym', label: 'Gimnasios & Fitness', icon: 'activity' },
    { value: 'beauty', label: 'Servicios & Belleza', icon: 'sparkles' },
    { value: 'service', label: 'Consultoría', icon: 'briefcase' },
    { value: 'manufacturing', label: 'Manufactura & Taller', icon: 'boxes' },
    { value: 'construction', label: 'Contratistas & Obra', icon: 'building-2' },
  ];

  // El carrusel de sectores avanza solo cada 10s y se detiene mientras el
  // puntero (o el foco) está dentro del bloque: si el visitante está leyendo,
  // cambiarle la tarjeta debajo es la peor manera de mostrarle el producto.
  private sectorTimer: ReturnType<typeof setInterval> | null = null;
  private sectorHovered = false;
  /**
   * Lado que ocupa la foto en la tarjeta del sector (derecha/izquierda en
   * escritorio, abajo/arriba en móvil). Se sortea en cada cambio de sector;
   * en el servidor queda fijo a la derecha para no romper la hidratación.
   */
  readonly sectorImageSide = signal<'left' | 'right'>('right');
  private sectorSideStreak = 1;

  readonly activeIndustryData = computed(() => {
    return this.industryData[this.selectedIndustry()] || this.industryData.retail;
  });

  /**
   * «Desde $X COP / mes» de la sección de inversión: el plan mensual más
   * barato que publica la API. Si aún no respondió (o falló), cae al mínimo
   * comercial vigente en vez de a un número inventado.
   */
  /**
   * Planes vendibles: la API pública también devuelve trials y promocionales
   * ($0, «Plan de Acceso Exclusivo»…) que no van en una landing. Sólo planes
   * base, no promocionales y con precio.
   */
  readonly sellablePlans = computed(() =>
    this.plans().filter(
      (p) =>
        (p.plan_type ?? 'base') === 'base' &&
        !p.is_promotional &&
        Number(p.base_price) > 0,
    ),
  );

  readonly cheapestMonthlyPrice = computed(() => {
    const prices = this.sellablePlans()
      .filter((p) => p.billing_cycle === 'monthly')
      .map((p) => Number(p.base_price))
      .filter((n) => Number.isFinite(n) && n > 0);
    return prices.length > 0 ? Math.min(...prices) : MIN_MONTHLY_PRICE_COP;
  });

  // Dynamic Available Cycles computed strictly from loaded API plans
  readonly availableCycles = computed(() => {
    const p = this.sellablePlans();
    if (!p || p.length === 0) return ['monthly', 'quarterly', 'annual'];
    const cycles = Array.from(new Set(p.map((item) => item.billing_cycle)));
    const order = ['monthly', 'quarterly', 'annual', 'semiannual', 'yearly', 'lifetime'];
    return cycles.sort((a, b) => {
      const idxA = order.indexOf(a);
      const idxB = order.indexOf(b);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });
  });

  // Dynamically filtered plans based on active selectedCycle
  readonly visiblePlans = computed(() => {
    const current = this.selectedCycle();
    const all = this.sellablePlans();
    const matched = all.filter((p) => p.billing_cycle === current);
    const cycle = matched.length > 0 ? current : this.availableCycles()[0];
    // Del más barato al más caro: en producción `sort_order` viene en 0 para
    // todos, así que el precio mensual equivalente es el único orden fiable.
    return all
      .filter((p) => p.billing_cycle === cycle)
      .sort((a, b) => {
        const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        return so !== 0 ? so : this.monthlyEquivalent(a) - this.monthlyEquivalent(b);
      });
  });

  // ── Ítems «incluye» del plan: card, modal y comparativa ────────────

  /** Los primeros 7 ítems, en el orden en que los escribió el super-admin. */
  visibleFeatures(plan: PublicPlan): PublicPlan['features'] {
    return (plan.features ?? []).slice(0, CARD_FEATURE_LIMIT);
  }

  /** Cuántos ítems quedaron fuera de la card (0 si caben todos). */
  hiddenFeatureCount(plan: PublicPlan): number {
    return Math.max(0, (plan.features?.length ?? 0) - CARD_FEATURE_LIMIT);
  }

  /**
   * El botón «Ver todo lo que incluye» sólo aparece si hay algo más que
   * enseñar: ítems ocultos o el markdown largo del plan. Con ≤7 ítems y sin
   * `details_md` la card ya lo dice todo y un botón sería ruido.
   */
  hasPlanDetail(plan: PublicPlan): boolean {
    return this.hiddenFeatureCount(plan) > 0 || !!plan.details_md?.trim();
  }

  readonly planDetailOpen = signal<boolean>(false);
  readonly planDetail = signal<PublicPlan | null>(null);

  /**
   * Markdown del plan a HTML. Se devuelve **string plano** y se enlaza con
   * `[innerHTML]`: el sanitizador de Angular limpia el marcado peligroso. NO
   * envolver en `DomSanitizer.bypassSecurityTrustHtml`, que lo desactivaría.
   */
  readonly planDetailHtml = computed<string>(() => {
    const md = this.planDetail()?.details_md ?? '';
    return md.trim() ? markdownToHtml(md) : '';
  });

  /** Lista completa del plan abierto en el modal (sin tope de 7). */
  readonly planDetailFeatures = computed(() =>
    normalizeIncludedItems(this.planDetail()?.features ?? []),
  );

  openPlanDetail(plan: PublicPlan): void {
    this.planDetail.set(plan);
    this.planDetailOpen.set(true);
  }

  closePlanDetail(): void {
    this.planDetailOpen.set(false);
  }

  /**
   * Comparativa construida con los planes del ciclo seleccionado, en el mismo
   * orden que las cards. `buildFeatureComparison` es todo-o-nada: devuelve
   * `null` si algún plan no tiene ítems, y el template cae entonces a la tabla
   * estática en vez de pintar una comparativa a medias.
   */
  readonly comparison = computed(() =>
    buildFeatureComparison(
      this.visiblePlans().map((plan) => ({
        name: plan.name,
        is_popular: plan.is_popular,
        features: normalizeIncludedItems(plan.features ?? []),
      })),
    ),
  );

  /**
   * `base_price` es lo que se cobra por período (el anual de Impulsa vale
   * 538.900, no 49.900). La card muestra el equivalente mensual para que los
   * cuatro planes se comparen en la misma unidad sea cual sea el ciclo.
   */
  monthlyEquivalent(plan: PublicPlan): number {
    const total = Number(plan.base_price) || 0;
    const months = CYCLE_MONTHS[plan.billing_cycle] ?? 1;
    // Redondeado: 538.900 / 12 daría 44.908,333 en pantalla.
    return Math.round(total / months);
  }

  /** Plan mensual del mismo nombre: la referencia contra la que se ahorra. */
  private monthlySibling(plan: PublicPlan): PublicPlan | undefined {
    if (plan.billing_cycle === 'monthly') return undefined;
    return this.sellablePlans().find(
      (p) => p.billing_cycle === 'monthly' && p.name === plan.name,
    );
  }

  /** Ahorro real (%) frente a pagar mes a mes; null si no hay con qué comparar. */
  planSavingsPct(plan: PublicPlan): number | null {
    const months = CYCLE_MONTHS[plan.billing_cycle];
    const monthly = this.monthlySibling(plan);
    if (!months || months <= 1 || !monthly) return null;
    const full = Number(monthly.base_price) * months;
    const paid = Number(plan.base_price);
    if (!(full > 0) || !(paid > 0) || paid >= full) return null;
    return Math.round(((full - paid) / full) * 100);
  }

  // ROI Savings Calculator Computed
  readonly annualSavings = computed(() => {
    const stores = this.storeCount();
    const invoices = this.invoicesCount();
    // Legacy competitor costs:
    // Legacy POS (~$180.000 COP/mo per store) + DIAN folios (~$280 COP/invoice) + web store plugin (~$90.000 COP/mo)
    const annualLegacy = stores * 180000 * 12 + invoices * 280 * 12 + 90000 * 12;
    // Vendix Pro annual plan: ~$95.200 COP/mo ($1.142.400/yr) includes up to 3 stores & unlimited DIAN
    const annualVendix =
      stores <= 3 ? 1142400 : 1142400 + (stores - 3) * 350000;
    return Math.max(0, annualLegacy - annualVendix);
  });

  ngOnInit(): void {
    // Tenant config listener
    this.tenantConfig.set({
      branding: {
        name: 'Vendix',
        logo: { url: 'vlogo.png' },
      },
    });

    this.tenantFacade.tenantConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((config) => {
        if (config) {
          this.tenantConfig.set(config);
        }
      });

    // Load canonical plans from backend API
    this.fetchPublicPlans();

    this.startSectorRotation();
    this.destroyRef.onDestroy(() => this.stopSectorRotation());
    this.destroyRef.onDestroy(() => this.teardownHeroWindow());
    this.destroyRef.onDestroy(() => this.clearVexiTimer());
  }

  fetchPublicPlans(): void {
    this.loadingPlans.set(true);
    this.plansError.set(false);

    this.publicPlansService.list$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.loadingPlans.set(false);
          if (response?.data && response.data.length > 0) {
            // Producción publica los planes SIN `features` aunque el tipo lo
            // declare obligatorio: se normaliza aquí, en la frontera, para
            // que el template pueda contar con un arreglo siempre.
            this.plans.set(
              response.data.map((plan) => ({ ...plan, features: plan.features ?? [] })),
            );
            const cycles = this.availableCycles();
            if (cycles.includes('annual')) {
              this.selectedCycle.set('annual');
            } else if (!cycles.includes(this.selectedCycle())) {
              this.selectedCycle.set(cycles[0] || 'monthly');
            }
          } else {
            this.useCuratedFallbackPlans();
          }
        },
        error: (err) => {
          console.warn('[VendixLanding] Public plans endpoint error, loading fallback:', err);
          this.loadingPlans.set(false);
          this.plansError.set(true);
          this.useCuratedFallbackPlans();
        },
      });
  }

  /**
   * Respaldo si la API no responde: los 4 planes base de producción con sus
   * precios reales por período (tomados de GET /api/public/plans el
   * 2026-09-06). Sin bullets: producción tampoco los publica, y la card
   * enlaza a la comparativa en su lugar.
   */
  private useCuratedFallbackPlans(): void {
    const catalog: Array<{
      code: string;
      name: string;
      description: string;
      popular?: boolean;
      ai?: boolean;
      prices: Record<'monthly' | 'quarterly' | 'annual', number>;
    }> = [
      {
        code: 'vendix-impulsa',
        name: 'Vendix Impulsa',
        description:
          'El empujón que tu negocio necesita para dar el salto digital: todo lo esencial para vender más.',
        prices: { monthly: 49_900, quarterly: 142_200, annual: 538_900 },
      },
      {
        code: 'emprendedor-pro',
        name: 'Emprendedor',
        description:
          'Usuarios e industrias ilimitados con todas las herramientas de venta, administración y venta en línea.',
        popular: true,
        prices: { monthly: 69_900, quarterly: 199_000, annual: 749_000 },
      },
      {
        code: 'empresarial-pro',
        name: 'Empresarial Pro',
        description:
          'Todo lo de Emprendedor más facturación y nómina electrónica, documento soporte y contabilidad automatizada.',
        prices: { monthly: 89_900, quarterly: 259_000, annual: 969_000 },
      },
      {
        code: 'ia-business',
        name: 'IA Business',
        description:
          'Escala tu operación con IA: límites ampliados, IA Tools e IA Agents en todos los procesos.',
        ai: true,
        prices: { monthly: 179_900, quarterly: 512_900, annual: 1_942_900 },
      },
    ];
    const cycles = ['monthly', 'quarterly', 'annual'] as const;
    const fallback: PublicPlan[] = catalog.flatMap((plan, i) =>
      cycles.map((cycle, j) => ({
        id: `${plan.code}-${cycle}`,
        code: cycle === 'monthly' ? plan.code : `${plan.code}-${cycle}`,
        name: plan.name,
        description: plan.description,
        base_price: plan.prices[cycle],
        currency: 'COP',
        billing_cycle: cycle,
        plan_type: 'base',
        is_promotional: false,
        is_popular: !!plan.popular,
        is_ai_plan: !!plan.ai,
        sort_order: i * 10 + j,
        features: [],
      })),
    );
    this.plans.set(fallback);
  }

  // Interactive UI Actions
  setBillingCycle(cycle: string): void {
    this.selectedCycle.set(cycle);
  }

  setVexiTab(tab: number): void {
    this.runVexiExample(tab);
  }

  /**
   * Reproduce un ejemplo como lo haría el panel real: la pregunta aparece,
   * Vexi «piensa» con los tres puntos y la frase de progreso, y llega la
   * respuesta con su traza de herramientas.
   */
  private runVexiExample(tab: number, question = ''): void {
    this.clearVexiTimer();
    this.activeVexiTab.set(tab);
    this.vexiCustomQuestion.set(question);
    this.vexiDecision.set('pending');
    this.vexiApplying.set(false);
    this.vexiPhase.set('typing');
    this.scrollVexiToEnd();
    this.scheduleVexi(() => {
      this.vexiPhase.set('answered');
      this.scrollVexiToEnd();
    }, VEXI_THINK_MS);
  }

  /** Botón «nueva conversación» del panel: vuelve al estado vacío con sus chips. */
  newVexiConversation(): void {
    this.clearVexiTimer();
    this.vexiPhase.set('empty');
    this.vexiDecision.set('pending');
    this.vexiApplying.set(false);
    this.vexiCustomQuestion.set('');
    this.vexiQuery.set('');
  }

  closeVexiPanel(): void {
    if (this.isBrowser) {
      const panel = document.querySelector<HTMLElement>('.lv-panel');
      if (panel) this.vexiStageHeight.set(panel.offsetHeight);
    }
    this.vexiPanelOpen.set(false);
    this.vexiVoiceRecording.set(false);
  }

  openVexiPanel(): void {
    this.vexiPanelOpen.set(true);
  }

  toggleVexiVoice(): void {
    this.vexiVoiceUi.update((on) => !on);
    this.vexiVoiceRecording.set(false);
  }

  // Sostener graba, soltar «envía»: al soltar se reproduce el siguiente ejemplo
  // como si se hubiera dictado.
  onVexiMicDown(event: Event): void {
    event.preventDefault();
    if (this.vexiPhase() === 'typing') return;
    this.vexiVoiceRecording.set(true);
  }

  onVexiMicUp(): void {
    if (!this.vexiVoiceRecording()) return;
    this.vexiVoiceRecording.set(false);
    const next = (this.activeVexiTab() % this.vexiExamples.length) + 1;
    this.runVexiExample(next);
  }

  onVexiMicCancel(): void {
    this.vexiVoiceRecording.set(false);
  }

  approveVexiProposal(): void {
    if (this.vexiApplying()) return;
    // WhatsApp se abre dentro del gesto del clic: desde un setTimeout el
    // navegador lo bloquearía como popup.
    if (this.activeVexiTab() === 4) {
      this.openWhatsApp(
        'Hola, autorizo la reposición de 24 unidades de Café Especial Huila 500g para reabastecer el inventario.',
      );
    }
    this.vexiApplying.set(true);
    this.scheduleVexi(() => {
      this.vexiApplying.set(false);
      this.vexiDecision.set('approved');
      this.scrollVexiToEnd();
    }, VEXI_APPLY_MS);
  }

  rejectVexiProposal(): void {
    if (this.vexiApplying()) return;
    this.vexiDecision.set('rejected');
    this.scrollVexiToEnd();
  }

  onVexiSubmit(event: Event): void {
    event.preventDefault();
    this.sendVexiCustomQuery();
  }

  private matchVexiExample(query: string): VexiDemoExample | null {
    const q = query.toLowerCase();
    if (/rentab|margen|ganan/.test(q)) return this.vexiExamples[0];
    if (/vend|rotaci|dormid/.test(q)) return this.vexiExamples[1];
    if (/factura|proveedor|compra|ocr/.test(q)) return this.vexiExamples[2];
    if (/stock|inventario|avis|alerta|repon/.test(q)) return this.vexiExamples[3];
    return null;
  }

  private scheduleVexi(fn: () => void, ms: number): void {
    if (!this.isBrowser || this.prefersReducedMotion()) {
      fn();
      return;
    }
    this.vexiTimer = setTimeout(() => {
      this.vexiTimer = null;
      fn();
    }, ms);
  }

  private clearVexiTimer(): void {
    if (this.vexiTimer) {
      clearTimeout(this.vexiTimer);
      this.vexiTimer = null;
    }
  }

  /** El panel real baja al último mensaje en cada turno; aquí igual. */
  private scrollVexiToEnd(): void {
    if (!this.isBrowser) return;
    requestAnimationFrame(() => {
      const scroller = document.getElementById('lv-scroller');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  setCurrency(currency: 'COP' | 'USD'): void {
    this.selectedCurrency.set(currency);
  }

  pauseSectorRotation(): void {
    this.sectorHovered = true;
  }

  resumeSectorRotation(): void {
    this.sectorHovered = false;
  }

  private startSectorRotation(): void {
    if (!this.isBrowser || this.sectorTimer) return;
    // Quien pidió menos movimiento no recibe un carrusel automático.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    this.sectorTimer = setInterval(() => {
      if (this.sectorHovered) return;
      const tabs = this.sectorTabs;
      const i = tabs.findIndex((tab) => tab.value === this.selectedIndustry());
      this.selectedIndustry.set(tabs[(i + 1) % tabs.length].value);
      this.rollSectorImageSide();
    }, SECTOR_ROTATION_MS);
  }

  private restartSectorRotation(): void {
    this.stopSectorRotation();
    this.startSectorRotation();
  }

  /** Sorteo del lado de la foto. Es aleatorio de verdad, pero nunca repite el
   *  mismo lado más de dos veces seguidas: tres fotos al mismo lado ya no se
   *  leen como «va cambiando». */
  private rollSectorImageSide(): void {
    if (!this.isBrowser) return;
    const current = this.sectorImageSide();
    let next: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
    if (next === current && this.sectorSideStreak >= 2) {
      next = current === 'left' ? 'right' : 'left';
    }
    this.sectorSideStreak = next === current ? this.sectorSideStreak + 1 : 1;
    this.sectorImageSide.set(next);
  }

  private stopSectorRotation(): void {
    if (this.sectorTimer) {
      clearInterval(this.sectorTimer);
      this.sectorTimer = null;
    }
  }

  setIndustry(industry: LandingSector): void {
    if (industry !== this.selectedIndustry()) this.rollSectorImageSide();
    this.selectedIndustry.set(industry);
    // Un clic manual reinicia el reloj: si no, el sector elegido podría durar
    // en pantalla lo que quedara del ciclo anterior.
    this.restartSectorRotation();
  }

  toggleFaq(faqId: number): void {
    this.openFaqId.update((current) => (current === faqId ? null : faqId));
  }

  updateStores(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.storeCount.set(parseInt(input.value, 10) || 1);
  }

  updateInvoices(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.invoicesCount.set(parseInt(input.value, 10) || 300);
  }

  onSelectPlan(plan: PublicPlan): void {
    const cycle = this.selectedCycle();
    const planParam = plan.code || plan.id;
    this.router.navigate(['/auth/register'], {
      queryParams: {
        plan: planParam,
        cycle,
      },
    });
  }

  executeVexiAction(): void {
    this.vexiChatMessages.update((messages) =>
      messages.map((m) =>
        m.actionText ? { ...m, completed: true } : m,
      ),
    );
    // Add confirmation message
    this.vexiChatMessages.update((messages) => [
      ...messages,
      {
        role: 'assistant',
        text: '✓ Orden de compra #OC-2026-084 enviada a Distribuidora Colanta por WhatsApp API. Reposición estimada: Mañana 08:00 AM.',
        time: '16:46',
      },
    ]);
  }

  sendVexiCustomQuery(): void {
    const query = this.vexiQuery().trim();
    if (!query) return;
    this.vexiQuery.set('');
    const match = this.matchVexiExample(query);
    this.runVexiExample(match ? match.id : 0, match ? '' : query);
  }

  getCycleDisplayLabel(cycle: string): string {
    switch (cycle) {
      case 'annual':
      case 'yearly':
        // El descuento real lo pone el badge (getCycleDiscountBadge).
        return 'Anual';
      case 'quarterly':
        return 'Trimestral';
      case 'semiannual':
        return 'Semestral';
      case 'monthly':
        return 'Mensual';
      case 'lifetime':
        return 'Pago Único';
      default:
        return cycle;
    }
  }

  /** Ahorro típico del ciclo (mediana entre los planes que lo ofrecen). */
  getCycleDiscountBadge(cycle: string): string | null {
    if (cycle === 'monthly' || cycle === 'lifetime') return null;
    const pcts = this.sellablePlans()
      .filter((p) => p.billing_cycle === cycle)
      .map((p) => this.planSavingsPct(p))
      .filter((n): n is number => n !== null && n > 0)
      .sort((a, b) => a - b);
    if (pcts.length === 0) return null;
    return `-${pcts[Math.floor(pcts.length / 2)]}%`;
  }

  getCyclePeriodSuffix(cycle: string): string {
    switch (cycle) {
      case 'annual':
      case 'yearly':
        return '/ mes (pago anual)';
      case 'quarterly':
        return '/ mes (pago trimestral)';
      case 'semiannual':
        return '/ mes (pago semestral)';
      case 'monthly':
        return '/ mes';
      default:
        return `/${cycle}`;
    }
  }

  getCycleSubtext(plan: PublicPlan): string {
    const total = this.formatPrice(plan.base_price);
    const savings = this.planSavingsPct(plan);
    const tail = savings ? ` · ahorras ${savings}%` : '';
    switch (plan.billing_cycle) {
      case 'annual':
      case 'yearly':
        return `Facturado anualmente ${total}${tail}`;
      case 'quarterly':
        return `Facturado cada 3 meses ${total}${tail}`;
      case 'semiannual':
        return `Facturado cada 6 meses ${total}${tail}`;
      case 'lifetime':
        return `Pago único ${total}`;
      default:
        return 'Facturado mensualmente';
    }
  }

  formatPrice(basePrice: number | string): string {
    const num = typeof basePrice === 'number' ? basePrice : parseFloat(basePrice) || 0;
    if (this.selectedCurrency() === 'USD') {
      const usd = Math.round(num / 4000);
      return `$ ${usd} USD`;
    }
    return `$ ${num.toLocaleString('es-CO')}`;
  }

  openWhatsApp(customText?: string): void {
    const text =
      customText ||
      'Hola, quiero conocer más de Vendix y solicitar una demostración para mi negocio.';
    const url = `${this.socialLinks.whatsapp}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  scrollToSection(sectionId: string): void {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
    this.closeMobileMenu();
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  // ── Ventana del simulador: cerrar · minimizar · pantalla completa ──
  // Los tres botones del semáforo se comportan como en macOS. Cerrar y
  // minimizar abandonan primero la pantalla completa (la animación de salida
  // corre siempre sobre la ventana en su sitio) y dejan en su lugar el icono
  // de «Vendix app», que vuelve a abrirla con su propia animación de entrada.

  closeHeroWindow(windowEl: HTMLElement): void {
    if (this.heroWindow() !== 'open') return;
    this.prepareHeroExit(windowEl);
    this.transitionHeroWindow('closing', 'closed', HERO_CLOSE_MS);
  }

  minimizeHeroWindow(windowEl: HTMLElement): void {
    if (this.heroWindow() !== 'open') return;
    this.prepareHeroExit(windowEl);
    this.transitionHeroWindow('minimizing', 'minimized', HERO_MINIMIZE_MS);
  }

  reopenHeroWindow(): void {
    const state = this.heroWindow();
    if (state !== 'closed' && state !== 'minimized') return;
    const enter: HeroWindowEnter = state === 'minimized' ? 'restoring' : 'opening';
    this.heroWindow.set('open');
    this.heroEnter.set(enter);
    this.heroStageHeight.set(null);
    this.scheduleHeroWindow(
      () => this.heroEnter.set(null),
      enter === 'restoring' ? HERO_RESTORE_MS : HERO_OPEN_MS,
    );
  }

  toggleHeroFullscreen(windowEl: HTMLElement): void {
    if (this.heroWindow() !== 'open') return;
    if (this.heroFullscreen()) {
      this.leaveHeroFullscreen();
      this.heroStageHeight.set(null);
      return;
    }
    this.captureHeroStage(windowEl);
    this.heroFullscreen.set(true);
    this.lockBodyScroll(true);
  }

  /** Si la ventana estaba a pantalla completa, el alto de referencia es el que
   *  se midió al entrar en ella (el del hueco en la landing), no el del viewport. */
  private prepareHeroExit(windowEl: HTMLElement): void {
    if (this.heroFullscreen()) {
      this.leaveHeroFullscreen();
    } else {
      this.captureHeroStage(windowEl);
    }
  }

  private leaveHeroFullscreen(): void {
    if (!this.heroFullscreen()) return;
    this.heroFullscreen.set(false);
    this.lockBodyScroll(false);
  }

  private captureHeroStage(windowEl: HTMLElement): void {
    const height = windowEl.offsetHeight;
    if (height > 0) this.heroStageHeight.set(height);
  }

  private transitionHeroWindow(
    transit: HeroWindowState,
    final: HeroWindowState,
    ms: number,
  ): void {
    this.heroWindow.set(transit);
    this.scheduleHeroWindow(() => this.heroWindow.set(final), ms);
  }

  private scheduleHeroWindow(fn: () => void, ms: number): void {
    if (this.heroTimer) {
      clearTimeout(this.heroTimer);
      this.heroTimer = null;
    }
    if (!this.isBrowser || this.prefersReducedMotion()) {
      fn();
      return;
    }
    this.heroTimer = setTimeout(() => {
      this.heroTimer = null;
      fn();
    }, ms);
  }

  private prefersReducedMotion(): boolean {
    return (
      this.isBrowser &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
  }

  private lockBodyScroll(locked: boolean): void {
    if (!this.isBrowser) return;
    document.body.style.overflow = locked ? 'hidden' : '';
  }

  private teardownHeroWindow(): void {
    if (this.heroTimer) clearTimeout(this.heroTimer);
    this.heroTimer = null;
    this.lockBodyScroll(false);
  }

  // ── Demo en vídeo (fachada liviana de YouTube) ───────────────
  // Antes del play no se descarga ni el reproductor ni un solo byte de vídeo:
  // sólo el fotograma. maxresdefault no existe en todos los vídeos, así que
  // ante un 404 se cae a hqdefault, que YouTube garantiza siempre.
  readonly demoThumbUrl = computed(() =>
    this.demoThumbFallback()
      ? `https://i.ytimg.com/vi/${DEMO_VIDEO_ID}/hqdefault.jpg`
      : `https://i.ytimg.com/vi/${DEMO_VIDEO_ID}/maxresdefault.jpg`,
  );

  readonly demoEmbedUrl = computed<SafeResourceUrl>(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube-nocookie.com/embed/${DEMO_VIDEO_ID}` +
        '?autoplay=1&rel=0&modestbranding=1&playsinline=1',
    ),
  );

  onDemoThumbError(): void {
    this.demoThumbFallback.set(true);
  }

  /**
   * Abre la conexión con YouTube al pasar el puntero por encima, no antes:
   * el DNS/TLS ya está resuelto cuando llega el clic, sin descargar vídeo.
   */
  warmDemoConnection(): void {
    if (this.demoWarmed || typeof document === 'undefined') return;
    this.demoWarmed = true;
    for (const origin of DEMO_ORIGINS) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      document.head.appendChild(link);
    }
  }

  playDemo(): void {
    this.demoPlaying.set(true);
  }

  showDemo(): void {
    this.showDemoModal.set(true);
  }

  closeDemo(): void {
    this.showDemoModal.set(false);
    // Destruye el iframe: corta el audio y el streaming al cerrar.
    this.demoPlaying.set(false);
  }
}

