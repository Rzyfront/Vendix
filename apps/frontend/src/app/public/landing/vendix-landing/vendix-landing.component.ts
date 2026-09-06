import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { CommonModule, DecimalPipe } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';
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

export interface IndustryPresentation {
  value: StoreIndustry;
  title: string;
  tag: string;
  headline: string;
  description: string;
  feature1: IndustryFeatureItem;
  feature2: IndustryFeatureItem;
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

@Component({
  selector: 'app-vendix-landing',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, DecimalPipe],
  templateUrl: './vendix-landing.component.html',
  styleUrls: ['./vendix-landing.component.scss'],
})
export class VendixLandingComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private publicPlansService = inject(PublicPlansService);
  private tenantFacade = inject(TenantFacade);

  // State Signals (Zoneless compliant)
  readonly tenantConfig = signal<any>(null);
  readonly mobileMenuOpen = signal<boolean>(false);
  readonly showTermsModal = signal<boolean>(false);
  readonly showDemoModal = signal<boolean>(false);

  // Plans & Pricing Signals
  readonly plans = signal<PublicPlan[]>([]);
  readonly loadingPlans = signal<boolean>(true);
  readonly plansError = signal<boolean>(false);
  readonly selectedCycle = signal<string>('annual');
  readonly selectedCurrency = signal<'COP' | 'USD'>('COP');

  // Industry Selector Signal
  readonly selectedIndustry = signal<StoreIndustry>('retail');

  // ROI Calculator Signals
  readonly storeCount = signal<number>(2);
  readonly invoicesCount = signal<number>(7200);

  // FAQ Accordion Signal
  readonly openFaqId = signal<number | null>(1);

  // Vexi Copilot Live Simulator Signal
  readonly vexiQuery = signal<string>('');
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
    whatsapp: 'https://wa.me/573009292888',
    email: 'soporte@vendix.online',
    domain: 'vendix.online',
  };

  // 6 Real Industry Presentations mapped from Vendix source of truth
  readonly industryData: Record<StoreIndustry, IndustryPresentation> = {
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
      image:
        'https://images.unsplash.com/photo-1556742049-0a67c5574f73?auto=format&fit=crop&w=1200&q=80',
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
      image:
        'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1200&q=80',
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
      image:
        'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=80',
    },
    service: {
      value: 'service',
      title: 'Servicios & Consultoría',
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
      image:
        'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80',
    },
    manufacturing: {
      value: 'manufacturing',
      title: 'Manufactura & Producción',
      tag: 'MANUFACTURA & TALLERES DE PRODUCCIÓN',
      headline: 'Explosión de materiales, órdenes de taller y costeo real',
      description:
        'Calcula con precisión el costo unitario de fabricación sumando materia prima, mano de obra e insumos. Genera órdenes de producción con descuento automático de inventario por etapa productiva.',
      feature1: {
        icon: 'boxes',
        title: 'Fórmulas & Recetas (BOM)',
        desc: 'Explosión de materiales para ensambles y productos terminados.',
      },
      feature2: {
        icon: 'trending-up',
        title: 'Costeo Estándar vs Real',
        desc: 'Detección inmediata de desviaciones de costo y mermas en planta.',
      },
      image:
        'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=1200&q=80',
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
      image:
        'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1200&q=80',
    },
  };

  readonly industriesList = STORE_INDUSTRIES;

  readonly activeIndustryData = computed(() => {
    return this.industryData[this.selectedIndustry()] || this.industryData.retail;
  });

  // Dynamic Available Cycles computed strictly from loaded API plans
  readonly availableCycles = computed(() => {
    const p = this.plans();
    if (!p || p.length === 0) return ['annual', 'monthly'];
    const cycles = Array.from(new Set(p.map((item) => item.billing_cycle)));
    const order = ['annual', 'quarterly', 'semiannual', 'monthly', 'yearly', 'lifetime'];
    return cycles.sort((a, b) => {
      const idxA = order.indexOf(a);
      const idxB = order.indexOf(b);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });
  });

  // Dynamically filtered plans based on active selectedCycle
  readonly visiblePlans = computed(() => {
    const current = this.selectedCycle();
    const all = this.plans();
    const matched = all.filter((p) => p.billing_cycle === current);
    if (matched.length > 0) return matched;
    // If no plans match the selected cycle, display first available cycle
    const fallbackCycle = this.availableCycles()[0];
    return all.filter((p) => p.billing_cycle === fallbackCycle);
  });

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

  readonly termsContent = computed(
    () => `
    <h3 class="text-lg font-bold mb-4 text-emerald-950">Términos y Condiciones — Vendix Platform</h3>
    <p class="text-sm text-gray-600 mb-4">Vendix es un sistema operativo comercial en la nube con punto de venta, inventario en tiempo real, catálogo omnicanal y habilitación directa para facturación electrónica DIAN.</p>

    <h4 class="font-bold text-gray-800 mt-4 mb-1 text-sm">1. Prueba Gratuita de 14 Días</h4>
    <p class="text-xs text-gray-600 mb-3">La prueba gratuita otorga acceso irrestricto a las funciones del Plan Pro. No se requiere ingresar tarjeta de crédito ni compromiso de permanencia. Finalizado el periodo, puedes seleccionar tu plan o tu cuenta quedará pausada sin penalidades.</p>

    <h4 class="font-bold text-gray-800 mt-4 mb-1 text-sm">2. Facturación Electrónica DIAN</h4>
    <p class="text-xs text-gray-600 mb-3">El emisor es responsable de la veracidad de la información tributaria registrada. Vendix garantiza la transmisión de documentos electrónicos con validación previa en cumplimiento del estatuto tributario colombiano vigente.</p>

    <h4 class="font-bold text-gray-800 mt-4 mb-1 text-sm">3. Privacidad y Seguridad de Datos</h4>
    <p class="text-xs text-gray-600 mb-3">En cumplimiento de la Ley 1581 de 2012 (Habeas Data), tus datos comerciales, clientes y transacciones son confidenciales y están resguardados con cifrado en reposo y en tránsito.</p>

    <h4 class="font-bold text-gray-800 mt-4 mb-1 text-sm">4. Cancelación y Portabilidad</h4>
    <p class="text-xs text-gray-600 mb-3">Puedes cancelar tu suscripción en cualquier momento desde tu panel administrativo y exportar la totalidad de tu inventario, ventas y clientes en formatos abiertos (XLSX, CSV, PDF).</p>
    <p class="text-xs text-gray-400 mt-4">Actualizado: Enero 2026 · Vendix Technologies Inc.</p>
  `,
  );

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
            this.plans.set(response.data);
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

  private useCuratedFallbackPlans(): void {
    // Defensive fallback adhering to F-002: accurate canonical Vendix plans
    const fallback: PublicPlan[] = [
      {
        id: 1,
        code: 'starter',
        name: 'Starter',
        description:
          'Ideal para pequeños comercios y tiendas independientes en formalización comercial.',
        base_price: 39200,
        currency: 'COP',
        billing_cycle: 'annual',
        is_popular: false,
        features: [
          { key: 'stores', label: '1 Tienda / Sucursal', enabled: true, limit: 1 },
          { key: 'users', label: '3 Usuarios con roles', enabled: true, limit: 3 },
          { key: 'pos', label: 'Punto de Venta POS Ilimitado', enabled: true },
          { key: 'offline', label: 'Modo Offline Seguro Activo', enabled: true },
          { key: 'accounting', label: 'Facturación Electrónica DIAN', enabled: true },
          { key: 'ecommerce', label: 'Catálogo Web & WhatsApp', enabled: true },
          { key: 'vexi', label: 'Copiloto Vexi IA', enabled: false },
        ],
      },
      {
        id: 2,
        code: 'pro',
        name: 'Pro',
        description:
          'Para comercios con alto flujo de ventas, restaurantes, multi-bodega y analítica avanzada.',
        base_price: 95200,
        currency: 'COP',
        billing_cycle: 'annual',
        is_popular: true,
        features: [
          { key: 'stores', label: 'Hasta 3 Sucursales incluidas', enabled: true, limit: 3 },
          { key: 'users', label: '10 Usuarios con auditoría de caja', enabled: true, limit: 10 },
          { key: 'vexi', label: 'Copiloto Vexi IA (200 consultas/día)', enabled: true },
          { key: 'ocr', label: 'Escáner OCR de facturas de compras', enabled: true },
          { key: 'inventory_adv', label: 'Multi-bodega & traslados de stock', enabled: true },
          { key: 'restaurant', label: 'Módulo Restaurantes (KDS + Mesas)', enabled: true },
          { key: 'support', label: 'Soporte prioritario WhatsApp 12h', enabled: true },
        ],
      },
      {
        id: 3,
        code: 'enterprise',
        name: 'Enterprise',
        description:
          'Solución integral para cadenas, franquicias y operaciones de gran escala con SLA garantizado.',
        base_price: 1290000,
        currency: 'COP',
        billing_cycle: 'annual',
        is_popular: false,
        features: [
          { key: 'stores', label: 'Sucursales / Tiendas Ilimitadas', enabled: true },
          { key: 'users', label: '50 Usuarios con auditoría avanzada', enabled: true, limit: 50 },
          { key: 'vexi', label: 'Vexi IA Ilimitada + Agente de Voz', enabled: true },
          { key: 'api', label: 'API abierta para ERP / SAP / Siigo', enabled: true },
          { key: 'domain', label: 'Dominio personalizado para tu e-commerce', enabled: true },
          { key: 'onboarding', label: 'Onboarding asistido & Account Manager', enabled: true },
          { key: 'sla', label: 'SLA de soporte técnico VIP en 4 horas', enabled: true },
        ],
      },
      {
        id: 4,
        code: 'starter_monthly',
        name: 'Starter',
        description:
          'Ideal para pequeños comercios y tiendas independientes en formalización comercial.',
        base_price: 49000,
        currency: 'COP',
        billing_cycle: 'monthly',
        is_popular: false,
        features: [
          { key: 'stores', label: '1 Tienda / Sucursal', enabled: true, limit: 1 },
          { key: 'users', label: '3 Usuarios con roles', enabled: true, limit: 3 },
          { key: 'pos', label: 'Punto de Venta POS Ilimitado', enabled: true },
          { key: 'offline', label: 'Modo Offline Seguro Activo', enabled: true },
          { key: 'accounting', label: 'Facturación Electrónica DIAN', enabled: true },
          { key: 'ecommerce', label: 'Catálogo Web & WhatsApp', enabled: true },
          { key: 'vexi', label: 'Copiloto Vexi IA', enabled: false },
        ],
      },
      {
        id: 5,
        code: 'pro_monthly',
        name: 'Pro',
        description:
          'Para comercios con alto flujo de ventas, restaurantes, multi-bodega y analítica avanzada.',
        base_price: 119000,
        currency: 'COP',
        billing_cycle: 'monthly',
        is_popular: true,
        features: [
          { key: 'stores', label: 'Hasta 3 Sucursales incluidas', enabled: true, limit: 3 },
          { key: 'users', label: '10 Usuarios con auditoría de caja', enabled: true, limit: 10 },
          { key: 'vexi', label: 'Copiloto Vexi IA (200 consultas/día)', enabled: true },
          { key: 'ocr', label: 'Escáner OCR de facturas de compras', enabled: true },
          { key: 'inventory_adv', label: 'Multi-bodega & traslados de stock', enabled: true },
          { key: 'restaurant', label: 'Módulo Restaurantes (KDS + Mesas)', enabled: true },
          { key: 'support', label: 'Soporte prioritario WhatsApp 12h', enabled: true },
        ],
      },
    ];
    this.plans.set(fallback);
  }

  // Interactive UI Actions
  setBillingCycle(cycle: string): void {
    this.selectedCycle.set(cycle);
  }

  setCurrency(currency: 'COP' | 'USD'): void {
    this.selectedCurrency.set(currency);
  }

  setIndustry(industry: StoreIndustry): void {
    this.selectedIndustry.set(industry);
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

    this.vexiChatMessages.update((messages) => [
      ...messages,
      {
        role: 'user',
        text: query,
        time: '16:47',
      },
      {
        role: 'assistant',
        text: `Vexi IA procesó tu solicitud en tiempo real: los indicadores de "${query}" han sido actualizados en tu dashboard central y sincronizados con tus canales de venta.`,
        time: '16:47',
      },
    ]);
    this.vexiQuery.set('');
  }

  getCycleDisplayLabel(cycle: string): string {
    switch (cycle) {
      case 'annual':
      case 'yearly':
        return 'Anual (2 Meses GRATIS)';
      case 'quarterly':
        return 'Trimestral (-10%)';
      case 'semiannual':
        return 'Semestral (-15%)';
      case 'monthly':
        return 'Facturación Mensual';
      case 'lifetime':
        return 'Pago Único';
      default:
        return cycle;
    }
  }

  getCyclePeriodSuffix(cycle: string): string {
    switch (cycle) {
      case 'annual':
      case 'yearly':
        return '/ mes (pago anual)';
      case 'quarterly':
        return '/ trimestre';
      case 'semiannual':
        return '/ semestre';
      case 'monthly':
        return '/ mes';
      default:
        return `/${cycle}`;
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

  showTerms(): void {
    this.showTermsModal.set(true);
  }

  closeTerms(): void {
    this.showTermsModal.set(false);
  }

  showDemo(): void {
    this.showDemoModal.set(true);
  }

  closeDemo(): void {
    this.showDemoModal.set(false);
  }
}

