import { Component, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-vendix-landing',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './vendix-landing.component.html',
  styleUrls: ['./vendix-landing.component.scss']
})
export class VendixLandingComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Tenant configuration for branding
  tenantConfig: any = null;

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
    // Subscribe to tenant configuration (includes branding and domain config)
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig) {
        this.tenantConfig = tenantConfig;
        
        // Update branding colors via CSS variables
        if (tenantConfig.branding?.colors) {
          this.updateCssVariables(tenantConfig.branding.colors);
        }

        // Load dynamic content from tenant config if available
        this.loadContentFromTenantConfig(tenantConfig);
      } else {
        // Initialize with default tenant config for Vendix platform
        this.tenantConfig = {
          branding: {
            name: 'Vendix',
            logo: '/assets/images/logo.png'
          }
        };
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private updateCssVariables(colors: any): void {
    const root = this.el.nativeElement;
    if (colors.primary) this.renderer.setStyle(root, '--color-primary', colors.primary);
    if (colors.secondary) this.renderer.setStyle(root, '--color-secondary', colors.secondary);
    if (colors.background) this.renderer.setStyle(root, '--color-background', colors.background);
    if (colors.text?.primary || colors.text) this.renderer.setStyle(root, '--color-text-primary', colors.text?.primary || colors.text);
    if (colors.text?.secondary) this.renderer.setStyle(root, '--color-text-secondary', colors.text?.secondary);
    if (colors.surface) this.renderer.setStyle(root, '--color-border', colors.surface);
  }

  getBackgroundGradient(): string {
    // This will now use the CSS variables if they are set, otherwise it will use the defaults from :root
    return `linear-gradient(to bottom right, var(--color-background) 0%, var(--color-secondary) 100%)`;
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
        price: '$49.900',
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
        price: '$149.900',
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
        price: '$399.900',
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