import {Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RouterModule } from '@angular/router';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';


import { HttpClient } from '@angular/common/http';
import { HeroCarouselComponent } from './components/hero-carousel/hero-carousel.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-vendix-landing',
  standalone: true,
  imports: [RouterModule, HeroCarouselComponent, IconComponent],
  templateUrl: './vendix-landing.component.html',
  styleUrls: ['./vendix-landing.component.scss']})
export class VendixLandingComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
// Signals para estado de UI (Zoneless-compatible)
  readonly tenantConfig = signal<any>(null);
  readonly mobileMenuOpen = signal(false);
  readonly plans = signal<any[]>([]);
  readonly features = signal<any[]>([]);
  readonly hero = signal<any>({});
  readonly footer = signal<any>({});
  readonly showTermsModal = signal(false);

  readonly termsContent = computed(() => `
    <h3 class="text-lg font-semibold mb-4">Términos y Condiciones Vendix Platform</h3>

    <h4 class="font-semibold mt-4 mb-2">1. Aceptación de Términos</h4>
    <p class="text-sm text-gray-600 mb-4">Al registrarte y utilizar Vendix Platform, aceptas estos términos y condiciones en su totalidad.</p>

    <h4 class="font-semibold mt-4 mb-2">2. Descripción del Servicio</h4>
    <p class="text-sm text-gray-600 mb-4">Vendix Platform es una plataforma de gestión empresarial que incluye POS, facturación, inventario y funcionalidades de IA según el plan contratado.</p>

    <h4 class="font-semibold mt-4 mb-2">3. Planes y Precios</h4>
    <p class="text-sm text-gray-600 mb-4">Los precios están expresados en pesos colombianos y se facturan mensualmente. Los cambios de plan se aplican al siguiente ciclo de facturación.</p>

    <h4 class="font-semibold mt-4 mb-2">4. Uso de Datos</h4>
    <p class="text-sm text-gray-600 mb-4">Nos comprometemos a proteger tus datos según la Ley 1581 de 2012 de Protección de Datos Personales.</p>

    <h4 class="font-semibold mt-4 mb-2">5. Propiedad Intelectual</h4>
    <p class="text-sm text-gray-600 mb-4">Todo el contenido, software y tecnología de Vendix Platform es propiedad intelectual de la empresa y está protegido por leyes de derechos de autor.</p>

    <h4 class="font-semibold mt-4 mb-2">6. Limitación de Responsabilidad</h4>
    <p class="text-sm text-gray-600 mb-4">Vendix Platform no se hace responsable por pérdidas indirectas, incidentales o consecuentes derivadas del uso del servicio.</p>

    <h4 class="font-semibold mt-4 mb-2">7. Cancelación</h4>
    <p class="text-sm text-gray-600 mb-4">Puedes cancelar tu suscripción en cualquier momento. No se realizan reembolsos parciales durante el ciclo de facturación vigente.</p>

    <h4 class="font-semibold mt-4 mb-2">8. Modificaciones</h4>
    <p class="text-sm text-gray-600 mb-4">Nos reservamos el derecho de modificar estos términos en cualquier momento. Te notificaremos cualquier cambio significativo con al menos 30 días de antelación.</p>

    <p class="text-xs text-gray-500 mt-6">Última actualización: Noviembre 2024</p>
  `);

  private tenantFacade = inject(TenantFacade);
  private http = inject(HttpClient);

  constructor() {}

  ngOnInit(): void {
    // Initialize with default tenant config for Vendix platform
    this.tenantConfig.set({
      branding: {
        name: 'Vendix',
        logo: {
          url: 'assets/images/logo.png'}}});

    // Always use default content for landing page
    this.initializeDefaultContent();

    // Subscribe to tenant configuration (includes branding and domain config)
    this.tenantFacade.tenantConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tenantConfig) => {
        if (tenantConfig) {
          this.tenantConfig.set(tenantConfig);
        }
      });
  }
getBackgroundGradient(): string {
    // This will now use the CSS variables if they are set, otherwise it will use the defaults from :root
    return `linear-gradient(to bottom right, var(--color-background) 0%, var(--color-secondary) 100%)`;
  }

  /**
   * Inicializa valores por defecto para el contenido dinámico
   */
  private initializeDefaultContent(): void {
    this.hero.set({
      title: 'El Futuro del Comercio Inteligente',
      subtitle:
        'Transforma tu negocio con IA integrada, ventas omnicanal y automatización total.',
      cta_primary: 'Comenzar Transformación',
      cta_secondary: 'Ver Demo en Vivo'});

    // PLANS ARRAY - COMMENTED OUT FOR EARLY ACCESS (all features are currently free)
    // this.plans.set([
    //   ...
    // ]);

    this.features.set([
      {
        icon: '🤖',
        title: 'IA Predictiva',
        description:
          'Inteligencia artificial que anticipa demanda, optimiza precios y personaliza experiencias de compra.'},
      {
        icon: '🏪',
        title: 'POS Inteligente',
        description:
          'Sistema de punto de venta con reconocimiento de productos, análisis de comportamiento y pagos sin contacto.'},
      {
        icon: '📦',
        title: 'Inventario Automatizado',
        description:
          'Gestión predictiva con reposición automática, optimización de stock y alertas inteligentes.'},
      {
        icon: '🛒',
        title: 'E-commerce Híbrido',
        description:
          'Ventas online con click-and-collect, experiencia omnicanal y sincronización en tiempo real.'},
      {
        icon: '📊',
        title: 'Analytics en Vivo',
        description:
          'Dashboard con métricas en tiempo real, predicciones de ventas y insights accionables con IA.'},
      {
        icon: '🎯',
        title: 'Marketing Inteligente',
        description:
          'Segmentación automática, campañas personalizadas y recomendaciones basadas en comportamiento.'},
      {
        icon: '🔄',
        title: 'Automatización Total',
        description:
          'Flujos de trabajo inteligentes, notificaciones automáticas y procesos sin intervención manual.'},
      {
        icon: '🌐',
        title: 'Multi-tenant Avanzado',
        description:
          'Gestión de múltiples organizaciones con configuración independiente y seguridad por capas.'},
      {
        icon: '💬',
        title: 'Chatbots IA',
        description:
          'Asistentes virtuales 24/7 para atención al cliente, ventas y soporte técnico personalizado.'},
    ]);

    this.footer.set({
      company_name: 'Vendix',
      description: 'La plataforma todo-en-uno para modernizar tu negocio',
      links: {
        product: ['POS', 'E-commerce', 'Inventario', 'Reportes'],
        support: [
          'Centro de Ayuda',
          'Documentación',
          'Contacto',
          'Estado del Sistema',
        ],
        company: ['Acerca de', 'Blog', 'Carreras', 'Prensa']},
      copyright: '© 2025 Vendix. Todos los derechos reservados.'});
  }

  scrollToPlans() {
    const plansSection = document.getElementById('early-access');
    plansSection?.scrollIntoView({ behavior: 'smooth' });
  }

  scrollToFeatures() {
    const featuresSection = document.getElementById('features');
    featuresSection?.scrollIntoView({ behavior: 'smooth' });
  }

  showTermsAndConditions() {
    this.showTermsModal.set(true);
  }

  closeTermsModal() {
    this.showTermsModal.set(false);
  }

  // Mobile menu methods
  toggleMobileMenu() {
    this.mobileMenuOpen.update(v => !v);

    // Prevent body scroll when menu is open
    if (this.mobileMenuOpen()) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
    document.body.style.overflow = '';
  }
}
