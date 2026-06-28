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
// popularArticles removed — the "Artículos más consultados" section
// confused users (read like generic documentation). The category
// chips + FAQ list now carry that discoverability.

/**
 * Public Help Center — entry point for unauthenticated visitors
 * who need help.
 *
 * Search & filtering model:
 *  - The search box is the single entry point. Typing in it
 *    filters the categories, the popular articles, AND the
 *    FAQ list at once (everything visible on the page).
 *  - Clicking a category chip pre-filters everything to that
 *    category. Click again (or use the "Quitar filtro" button
 *    that appears) to clear.
 *  - Search and category filter combine: typing "PQR" while
 *    the "Facturación" category is selected narrows to FAQs
 *    about PQR in Facturación.
 *
 * Visual hierarchy when filters are active:
 *  - Empty filter → all sections in their full form
 *  - Active filter → matching count shown in section titles;
 *    non-matching sections hide entirely; "Quitar filtro"
 *    banner appears at the top of the FAQ list
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

  /** Search input bound to the search box. */
  readonly searchQuery = signal('');

  /** Category chip currently selected (null = "show all"). */
  readonly selectedCategory = signal<FaqItem['category'] | null>(null);

  /** Whether the visitor is signed in. */
  readonly isAuthenticated = this.authFacade.isAuthenticated;

  /** All available categories. `faqCount` is computed up-front so
   *  the UI can show "3 artículos" on each chip — signals value
   *  to the visitor that each category has content, not an empty
   *  state. */
  readonly categories: HelpCategory[] = [
    {
      id: 'inventory',
      icon: 'package-open',
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
      icon: 'file-text',
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
      icon: 'user-round',
      title: 'Usuarios',
      description: 'Roles, permisos y equipo de trabajo',
    },
    {
      id: 'shipping',
      icon: 'inbox',
      title: 'Despachos',
      description: 'Rutas, transportadoras y guías',
    },
  ];

  /** Top articles — REMOVED. See interface comment. */
  readonly popularArticles: PopularArticle[] = [];

  /** FAQ list. */
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

  /** True if any filter is currently active. */
  readonly hasActiveFilter = computed(
    () => this.searchQuery().trim().length > 0 || this.selectedCategory() !== null,
  );

  /** Normalized search query. Trim + lowercase once so filters
   *  are consistent. */
  private readonly normalizedQuery = computed(() =>
    this.searchQuery().trim().toLowerCase(),
  );

  /** Filtered categories — hides when no match, otherwise leaves
   *  them in their natural order. Match: query appears in title
   *  OR description. */
  readonly filteredCategories = computed<HelpCategory[]>(() => {
    const q = this.normalizedQuery();
    const cat = this.selectedCategory();
    if (!q && !cat) return this.categories;
    return this.categories.filter((c) => {
      if (cat && c.id !== cat) return false;
      if (q && !`${c.title} ${c.description}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  });

  /** Filtered FAQs. */
  readonly filteredFaqs = computed<FaqItem[]>(() => {
    const q = this.normalizedQuery();
    const cat = this.selectedCategory();
    if (!q && !cat) return this.faqs();
    return this.faqs().filter((f) => {
      if (cat && f.category !== cat) return false;
      if (q) {
        const haystack = `${f.question} ${f.answer}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  });

  /** Counts for the active filter — used in section headings to
   *  show "(3)" after the title when a filter is active. */
  readonly filteredCategoryCount = computed(() => this.filteredCategories().length);
  readonly filteredFaqCount = computed(() => this.filteredFaqs().length);

  /** Toggle a category chip on/off. Clicking the same chip again
   *  clears the filter. */
  selectCategory(id: FaqItem['category']): void {
    this.selectedCategory.update((current) => (current === id ? null : id));
  }

  /** Clear all active filters at once. */
  clearAllFilters(): void {
    this.searchQuery.set('');
    this.selectedCategory.set(null);
  }
}
