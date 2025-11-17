import { Component, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { HeroCarouselComponent } from './components/hero-carousel/hero-carousel.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-vendix-landing',
  standalone: true,
  imports: [CommonModule, RouterModule, HeroCarouselComponent, IconComponent],
  templateUrl: './vendix-landing.component.html',
  styleUrls: ['./vendix-landing.component.scss']
})
export class VendixLandingComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Tenant configuration for branding
  tenantConfig: any = null;

  // Mobile menu state
  mobileMenuOpen = false;

  // Dynamic data from backend
  plans: any[] = [];
  features: any[] = [];
  hero: any = {};
  footer: any = {};

  constructor(
    private tenantFacade: TenantFacade,
    private http: HttpClient,
    private el: ElementRef,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    // Initialize with default tenant config for Vendix platform
    this.tenantConfig = {
      branding: {
        name: 'Vendix',
        logo: {
          url: 'assets/images/logo.png'
        }
      }
    };

    // Always use default content for landing page
    this.initializeDefaultContent();
    console.log('Planes initialized:', this.plans);

    // Subscribe to tenant configuration (includes branding and domain config)
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig) {
        this.tenantConfig = tenantConfig;
        console.log('Tenant config updated:', tenantConfig);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }


  getBackgroundGradient(): string {
    // This will now use the CSS variables if they are set, otherwise it will use the defaults from :root
    return `linear-gradient(to bottom right, var(--color-background) 0%, var(--color-secondary) 100%)`;
  }

  /**
   * Carga contenido dinámico desde la configuración del tenant
   */
  private loadContentFromTenantConfig(tenantConfig: any): void {
    // Siempre usar configuración por defecto para landing page
    this.initializeDefaultContent();
  }

  /**
   * Inicializa valores por defecto para el contenido dinámico
   */
  private initializeDefaultContent(): void {
    this.hero = {
      title: 'El Futuro del Comercio Inteligente',
      subtitle: 'Transforma tu negocio con IA integrada, ventas omnicanal y automatización total.',
      cta_primary: 'Comenzar Transformación',
      cta_secondary: 'Ver Demo en Vivo'
    };

    this.plans = [
      {
        name: 'Plan Inicial',
        price: '$49.900',
        period: '/mes',
        description: 'Todas las funcionalidades básicas sin IA',
        features: [
          'Hasta 1,000 productos',
          'POS tradicional completo',
          'Gestión de inventario manual',
          'Reportes básicos',
          'Facturación electrónica',
          'Soporte por email',
          '2 usuarios',
          'API básica'
        ],
        highlighted: false,
        cta_text: 'Comenzar Gratis'
      },
      {
        name: 'Plan Pro',
        price: '$149.900',
        period: '/mes',
        description: 'Funcionalidades limitadas de IA',
        features: [
          'Productos ilimitados',
          'POS con IA básica',
          'Inventario semi-automatizado',
          'Analytics con IA',
          'Chatbot básico',
          'Recomendaciones simples',
          'Hasta 10 usuarios',
          'API completa',
          'Integraciones principales',
          'Soporte prioritario'
        ],
        highlighted: true,
        cta_text: 'Probar 14 días gratis'
      },
      {
        name: 'Plan Ultra',
        price: '$399.900',
        period: '/mes',
        description: 'Todas las funciones con IA sin límites',
        features: [
          'Todo en Plan Pro',
          'Usuarios ilimitados',
          'IA predictiva avanzada',
          'Machine learning personalizado',
          'Automatización total',
          'Análisis avanzado con IA',
          'Chatbots multi-idioma',
          'Soporte 24/7',
          'Consultoría IA incluida',
          'SLA garantizado',
          'Personalización a medida'
        ],
        highlighted: false,
        cta_text: 'Contactar Expertos'
      }
    ];

    this.features = [
      {
        icon: '🤖',
        title: 'IA Predictiva',
        description: 'Inteligencia artificial que anticipa demanda, optimiza precios y personaliza experiencias de compra.'
      },
      {
        icon: '🏪',
        title: 'POS Inteligente',
        description: 'Sistema de punto de venta con reconocimiento de productos, análisis de comportamiento y pagos sin contacto.'
      },
      {
        icon: '📦',
        title: 'Inventario Automatizado',
        description: 'Gestión predictiva con reposición automática, optimización de stock y alertas inteligentes.'
      },
      {
        icon: '🛒',
        title: 'E-commerce Híbrido',
        description: 'Ventas online con click-and-collect, experiencia omnicanal y sincronización en tiempo real.'
      },
      {
        icon: '📊',
        title: 'Analytics en Vivo',
        description: 'Dashboard con métricas en tiempo real, predicciones de ventas y insights accionables con IA.'
      },
      {
        icon: '🎯',
        title: 'Marketing Inteligente',
        description: 'Segmentación automática, campañas personalizadas y recomendaciones basadas en comportamiento.'
      },
      {
        icon: '🔄',
        title: 'Automatización Total',
        description: 'Flujos de trabajo inteligentes, notificaciones automáticas y procesos sin intervención manual.'
      },
      {
        icon: '🌐',
        title: 'Multi-tenant Avanzado',
        description: 'Gestión de múltiples organizaciones con configuración independiente y seguridad por capas.'
      },
      {
        icon: '💬',
        title: 'Chatbots IA',
        description: 'Asistentes virtuales 24/7 para atención al cliente, ventas y soporte técnico personalizado.'
      }
    ];

    this.footer = {
      company_name: 'Vendix',
      description: 'La plataforma todo-en-uno para modernizar tu negocio',
      links: {
        product: ['POS', 'E-commerce', 'Inventario', 'Reportes'],
        support: ['Centro de Ayuda', 'Documentación', 'Contacto', 'Estado del Sistema'],
        company: ['Acerca de', 'Blog', 'Carreras', 'Prensa']
      },
      copyright: '© 2025 Vendix. Todos los derechos reservados.'
    };
  }

  scrollToPlans() {
    const plansSection = document.getElementById('pricing');
    plansSection?.scrollIntoView({ behavior: 'smooth' });
  }

  scrollToFeatures() {
    const featuresSection = document.getElementById('features');
    featuresSection?.scrollIntoView({ behavior: 'smooth' });
  }

  showTermsModal = false;
  termsContent = `
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
  `;

  showTermsAndConditions() {
    this.showTermsModal = true;
  }

  closeTermsModal() {
    this.showTermsModal = false;
  }

  // Mobile menu methods
  toggleMobileMenu() {
    this.mobileMenuOpen = !this.mobileMenuOpen;

    // Prevent body scroll when menu is open
    if (this.mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }

  closeMobileMenu() {
    this.mobileMenuOpen = false;
    document.body.style.overflow = '';
  }
}