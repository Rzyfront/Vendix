import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../shared/components/card/card.component';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { TenantFacade } from '../../core/store/tenant/tenant.facade';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, ButtonComponent],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Branding colors from domain config - reactive (initialized with neutral defaults)
  brandingColors = {
    primary: '#3B82F6', // Default blue
    secondary: '#1E40AF', // Default dark blue
    accent: '#FFFFFF', // White
    background: '#F8FAFC', // Light gray
    text: '#1E293B', // Dark gray
    border: '#E2E8F0' // Light border
  };

  // Dynamic data from backend
  plans: any[] = [];
  features: any[] = [];
  hero: any = {};
  footer: any = {};

  constructor(
    private tenantFacade: TenantFacade,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    // Subscribe to tenant configuration (includes branding and domain config)
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig) {
        // Update branding colors
        if (tenantConfig.branding?.colors) {
          const colors = tenantConfig.branding.colors;
          this.brandingColors = {
            primary: colors.primary || this.brandingColors.primary,
            secondary: colors.secondary || this.brandingColors.secondary,
            accent: colors.accent || this.brandingColors.accent,
            background: colors.background || this.brandingColors.background,
            text: colors.text?.primary || this.brandingColors.text,
            border: colors.surface || this.brandingColors.border
          };
        }

        // Load dynamic content from tenant config if available
        this.loadContentFromTenantConfig(tenantConfig);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }


  getBackgroundGradient(): string {
    return `linear-gradient(to bottom right, ${this.brandingColors.background}80, ${this.brandingColors.secondary}20)`;
  }

  /**
   * Carga contenido dinámico desde la configuración del tenant
   */
  private loadContentFromTenantConfig(tenantConfig: any): void {
    // Si la configuración del tenant incluye contenido dinámico para landing
    if (tenantConfig.landing) {
      this.hero = { ...this.hero, ...tenantConfig.landing.hero };
      this.footer = { ...this.footer, ...tenantConfig.landing.footer };

      if (tenantConfig.landing.plans) {
        this.plans = tenantConfig.landing.plans;
      }

      if (tenantConfig.landing.features) {
        this.features = tenantConfig.landing.features;
      }
    } else {
      // Usar configuración por defecto
      this.initializeDefaultContent();
    }
  }

  /**
   * Inicializa valores por defecto para el contenido dinámico
   */
  private initializeDefaultContent(): void {
    this.hero = {
      title: 'La Plataforma Todo-en-Uno para tu Negocio',
      subtitle: 'Combina POS, E-commerce y gestión de inventario en una sola plataforma.',
      cta_primary: 'Prueba Gratis por 14 Días',
      cta_secondary: 'Ver Características'
    };

    this.plans = [
      {
        name: 'Starter',
        price: '$119.900',
        period: '/mes',
        description: 'Perfecto para pequeños negocios',
        features: [
          'Hasta 100 productos',
          'POS básico',
          'Inventario básico',
          'Reportes básicos',
          'Soporte por email',
          '1 usuario'
        ],
        highlighted: false,
        cta_text: 'Comenzar Gratis'
      },
      {
        name: 'Professional',
        price: '$329.900',
        period: '/mes',
        description: 'Para negocios en crecimiento',
        features: [
          'Productos ilimitados',
          'POS avanzado',
          'Gestión completa de inventario',
          'Reportes avanzados',
          'Múltiples tiendas',
          'Hasta 5 usuarios',
          'Soporte prioritario',
          'Integraciones API'
        ],
        highlighted: true,
        cta_text: 'Prueba 14 días gratis'
      },
      {
        name: 'Enterprise',
        price: '$829.900',
        period: '/mes',
        description: 'Para grandes organizaciones',
        features: [
          'Todo en Professional',
          'Usuarios ilimitados',
          'Múltiples organizaciones',
          'Personalización avanzada',
          'Soporte 24/7',
          'Gerente de cuenta dedicado',
          'SLA garantizado',
          'Instalación on-premise'
        ],
        highlighted: false,
        cta_text: 'Contactar Ventas'
      }
    ];

    this.features = [
      {
        icon: '🏪',
        title: 'POS Inteligente',
        description: 'Sistema de punto de venta completo con procesamiento rápido de transacciones y múltiples métodos de pago.'
      },
      {
        icon: '📦',
        title: 'Gestión de Inventario',
        description: 'Control total de tu inventario con alertas automáticas, seguimiento en tiempo real y gestión de proveedores.'
      },
      {
        icon: '🛒',
        title: 'E-commerce Integrado',
        description: 'Tienda online completamente integrada con tu POS para ventas omnicanal perfectas.'
      },
      {
        icon: '📊',
        title: 'Reportes Avanzados',
        description: 'Análisis detallados de ventas, tendencias y rendimiento para tomar decisiones informadas.'
      },
      {
        icon: '👥',
        title: 'Gestión de Clientes',
        description: 'CRM integrado para seguimiento de clientes, programas de lealtad y marketing personalizado.'
      },
      {
        icon: '🏢',
        title: 'Multi-tienda',
        description: 'Gestiona múltiples ubicaciones desde una sola plataforma con sincronización automática.'
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
    const plansSection = document.getElementById('plans');
    plansSection?.scrollIntoView({ behavior: 'smooth' });
  }

  scrollToFeatures() {
    const featuresSection = document.getElementById('features');
    featuresSection?.scrollIntoView({ behavior: 'smooth' });
  }
}
