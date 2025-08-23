import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../shared/components/card/card.component';
import { ButtonComponent } from '../../shared/components/button/button.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, ButtonComponent],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent {
    plans = [
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
      ctaText: 'Comenzar Gratis'
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
      ctaText: 'Prueba 14 días gratis'
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
      ctaText: 'Contactar Ventas'
    }
  ];

  features = [
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

  scrollToPlans() {
    const plansSection = document.getElementById('plans');
    plansSection?.scrollIntoView({ behavior: 'smooth' });
  }

  scrollToFeatures() {
    const featuresSection = document.getElementById('features');
    featuresSection?.scrollIntoView({ behavior: 'smooth' });
  }
}
