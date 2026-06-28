import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: 'inventory' | 'online-store' | 'billing' | 'reports' | 'users' | 'shipping';
}

interface HelpCategory {
  id: FaqItem['category'];
  icon: string;
  title: string;
  description: string;
}

interface PopularArticle {
  id: string;
  title: string;
  category: FaqItem['category'];
}

/**
 * Public Help Center — entry point for unauthenticated visitors
 * who need help. Mirrors the structure the user described:
 *  - Hero "Centro de Ayuda" + "¿En qué podemos ayudarle?" + search
 *  - Categorías (cards) — for quick navigation by area
 *  - Artículos populares — reduce PQRS volume by surfacing common
 *    solutions inline
 *  - FAQ list (filtered live by the search query)
 *  - CTA "No encontraste la respuesta?" with conditional copy:
 *      - Anonymous visitor → "Crear una solicitud" → /pqr
 *      - Logged-in user    → "Nueva solicitud" + "Ver mis solicitudes"
 *        with side-by-side buttons
 */
@Component({
  selector: 'app-help-center',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, IconComponent],
  templateUrl: './help-center.component.html',
  styleUrls: ['./help-center.component.scss'],
})
export class HelpCenterComponent {
  private readonly authFacade = inject(AuthFacade);

  /** Search input bound to the search box in the hero. */
  readonly searchQuery = signal('');

  /** Whether the visitor is signed in — drives the CTA copy. */
  readonly isAuthenticated = this.authFacade.isAuthenticated;

  /** Static category cards for quick nav. Each maps to a subset of
   *  the FAQ list so clicking a card could (in a future iteration)
   *  pre-filter the FAQ section. */
  readonly categories: HelpCategory[] = [
    {
      id: 'inventory',
      icon: 'package',
      title: 'Inventario',
      description: 'Stock, bodegas, movimientos y alertas',
    },
    {
      id: 'online-store',
      icon: 'shopping-cart',
      title: 'Tienda en línea',
      description: 'Catálogo, checkout y storefront público',
    },
    {
      id: 'billing',
      icon: 'credit-card',
      title: 'Facturación',
      description: 'Factura electrónica, pagos y conciliaciones',
    },
    {
      id: 'reports',
      icon: 'bar-chart',
      title: 'Reportes',
      description: 'Ventas, inventario y métricas del negocio',
    },
    {
      id: 'users',
      icon: 'users',
      title: 'Usuarios',
      description: 'Roles, permisos y equipo de trabajo',
    },
    {
      id: 'shipping',
      icon: 'truck',
      title: 'Despachos',
      description: 'Rutas, transportadoras y guías',
    },
  ];

  /** Top articles — click handlers would route to a /ayuda/:slug
   *  detail page; for now they're visual placeholders. */
  readonly popularArticles: PopularArticle[] = [
    { id: 'create-store', title: 'Cómo crear una tienda', category: 'online-store' },
    { id: 'e-billing', title: 'Cómo configurar facturación electrónica', category: 'billing' },
    { id: 'custom-domain', title: 'Cómo conectar un dominio personalizado', category: 'online-store' },
    { id: 'invite-user', title: 'Cómo crear un usuario y asignar permisos', category: 'users' },
  ];

  /** FAQ items — static for now, will move to a backend fetch once
   *  there's a public knowledge-base endpoint. */
  readonly faqs = signal<FaqItem[]>([
    {
      id: 'pricing-1',
      category: 'billing',
      question: '¿Cuánto cuesta Vendix?',
      answer:
        'Durante el periodo de acceso anticipado, todas las funcionalidades están incluidas sin costo. Cuando lancemos los planes pagos, publicaremos los precios en esta misma página y por correo a todos los usuarios activos.',
    },
    {
      id: 'getting-started-1',
      category: 'online-store',
      question: '¿Cómo creo mi tienda?',
      answer:
        'Haz clic en "Comenzar Gratis" en la parte superior, completa el formulario de registro con tu correo y sigue los pasos del wizard. En menos de 5 minutos tendrás tu tienda lista para recibir clientes.',
    },
    {
      id: 'features-1',
      category: 'inventory',
      question: '¿Puedo conectar Vendix con mi tienda física?',
      answer:
        'Sí. Vendix incluye un módulo POS (Punto de Venta) que sincroniza el inventario entre la tienda física y el e-commerce en tiempo real. Una misma bodega, dos canales de venta.',
    },
    {
      id: 'shipping-1',
      category: 'shipping',
      question: '¿Cómo configuro mis transportadoras?',
      answer:
        'En el panel de Despachos, ve a Configuración → Transportadoras y agrega cada una con su API key. Vendix se conecta con las principales transportadoras colombianas para generar guías automáticamente.',
    },
    {
      id: 'support-1',
      category: 'users',
      question: '¿Qué pasa si tengo un problema urgente con una venta?',
      answer:
        'Crea una solicitud desde el botón "Crear una solicitud" más abajo. Las solicitudes se atienden en orden de llegada, pero las marcadas como urgentes tienen prioridad.',
    },
  ]);

  /** FAQs filtered by the search query. Empty query → show everything. */
  readonly filteredFaqs = computed<FaqItem[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return this.faqs();
    return this.faqs().filter(
      (f) =>
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q),
    );
  });
}
