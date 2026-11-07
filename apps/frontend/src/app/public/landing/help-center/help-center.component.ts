import { Component, signal, computed, inject, ElementRef, ViewChild, effect, DestroyRef } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { PublicHeaderComponent } from '../components/public-header/public-header.component';
import { Meta, Title } from '@angular/platform-browser';
import { applyMarketingPageMetadata, MARKETING_PAGES } from '../../marketing-page-metadata';

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
  imports: [CommonModule, RouterModule, FormsModule, IconComponent, PublicHeaderComponent],
  templateUrl: './help-center.component.html',
  styleUrls: ['./help-center.component.scss'],
})
export class HelpCenterComponent {
  // SEO-TECH-04: título, descripción, robots y canonical propios en el host comercial.
  private readonly restoreMarketingMetadata = applyMarketingPageMetadata(
    inject(DOCUMENT),
    inject(Title),
    inject(Meta),
    MARKETING_PAGES.help,
  );
  private readonly marketingMetadataCleanup = inject(DestroyRef).onDestroy(
    this.restoreMarketingMetadata,
  );

  private readonly authFacade = inject(AuthFacade);

  /** Ref to the FAQ section so we can scroll to it when a category
   *  is selected — otherwise the user clicks a chip and sees no
   *  feedback except the section count changing. */
  @ViewChild('faqSection', { read: ElementRef })
  faqSectionRef?: ElementRef<HTMLElement>;

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

  /** FAQ list. ~5-7 per category so the filtered view is meaty
   *  when the user clicks a category chip. */
  readonly faqs = signal<FaqItem[]>([
    // ── Inventory (6) ─────────────────────────────────────
    {
      id: 'inv-1',
      category: 'inventory',
      question: '¿Cómo agrego un nuevo producto a mi inventario?',
      answer:
        'Ve a Productos → Lista y crea un producto nuevo. Solo son obligatorios el nombre y el precio; el SKU, el stock inicial y las imágenes son opcionales. Puedes indicar si el producto estará disponible en tu tienda en línea.',
    },
    {
      id: 'inv-2',
      category: 'inventory',
      question: '¿Puedo gestionar varias bodegas?',
      answer:
        'Sí. En Inventario → Ubicaciones crea las bodegas, tiendas o ubicaciones que necesites. Cada producto lleva su stock por ubicación y puedes ver el detalle por bodega.',
    },
    {
      id: 'inv-3',
      category: 'inventory',
      question: '¿Cómo hago ajustes de inventario masivos?',
      answer:
        'Para cambiar precio, estado u otros campos de varios productos a la vez, usa la edición masiva de Productos. Para ajustar stock en bloque, ve a Inventario → Ajustes de Stock y carga la plantilla en Excel o CSV.',
    },
    {
      id: 'inv-4',
      category: 'inventory',
      question: '¿Qué pasa cuando un producto se queda sin stock?',
      answer:
        'Por defecto, los productos sin stock se ocultan del catálogo de tu tienda en línea (puedes elegir mostrarlos como "Agotado"). Si activas "Permitir sobreventa", podrás seguir vendiendo sin stock. Las alertas de stock bajo te llegan como notificación en el panel.',
    },
    {
      id: 'inv-5',
      category: 'inventory',
      question: '¿Puedo importar productos desde un Excel?',
      answer:
        'Sí. Desde Productos usa la carga masiva: descarga la plantilla, complétala y súbela en .xlsx, .xls o .csv (máximo 20 MB). Vendix revisa el archivo y te muestra los errores antes de confirmar la importación.',
    },
    {
      id: 'inv-6',
      category: 'inventory',
      question: '¿Cómo veo el historial de movimientos de un producto?',
      answer:
        'En Inventario → Movimientos busca el producto para ver sus entradas, salidas, transferencias y ajustes, con fecha, usuario responsable y motivo.',
    },

    // ── Online store (7) ─────────────────────────────────
    {
      id: 'store-1',
      category: 'online-store',
      question: '¿Cómo creo mi tienda?',
      answer:
        'Haz clic en "Comenzar Gratis" en la parte superior, completa el formulario de registro con tu correo y sigue los pasos del wizard. En menos de 5 minutos tendrás tu tienda lista para recibir clientes.',
    },
    {
      id: 'store-2',
      category: 'online-store',
      question: '¿Puedo usar mi propio dominio?',
      answer:
        'Sí. En Configuración → Dominios agrega tu dominio (ej. mitienda.com). Vendix te indica los registros DNS que debes crear en tu proveedor de dominio y el certificado SSL se emite automáticamente.',
    },
    {
      id: 'store-3',
      category: 'online-store',
      question: '¿Qué métodos de pago aceptan?',
      answer:
        'Con Wompi puedes recibir tarjetas débito y crédito, PSE, Nequi, Daviplata y Bancolombia. También puedes ofrecer efectivo, transferencia bancaria, datáfono y pago contra entrega. Actívalos en Configuración → Métodos de Pago; las pasarelas requieren tus credenciales.',
    },
    {
      id: 'store-4',
      category: 'online-store',
      question: '¿Cómo personalizo el diseño de mi tienda?',
      answer:
        'En Tienda en línea sube tu logo y favicon, define los colores de tu marca y configura el slider y las secciones de la página de inicio.',
    },
    {
      id: 'store-5',
      category: 'online-store',
      question: '¿Cómo creo cupones de descuento?',
      answer:
        'En Marketing → Cupones define un código, el tipo de descuento (% o monto fijo), la vigencia, el monto mínimo y los límites de uso. Tu cliente escribe el código en el checkout y el descuento se aplica.',
    },
    {
      id: 'store-6',
      category: 'online-store',
      question: '¿Puedo vender sin tener tienda física?',
      answer:
        'Sí. Con la tienda en línea de Vendix tienes catálogo público, pagos en línea con Wompi y métodos de envío, sin necesidad de un local físico.',
    },
    {
      id: 'store-7',
      category: 'online-store',
      question: '¿Cómo funciona el checkout?',
      answer:
        'El cliente agrega productos al carrito, llena sus datos, elige método de pago y envío, y confirma. El pedido entra a tus Órdenes y recibes una notificación en el panel.',
    },

    // ── Billing (6) ──────────────────────────────────────
    {
      id: 'bill-1',
      category: 'billing',
      question: '¿Cuánto cuesta Vendix?',
      answer:
        'Vendix funciona con planes de suscripción mensuales y anuales, con un periodo de prueba al registrarte. Consulta los planes y precios vigentes en la página de Planes y precios.',
    },
    {
      id: 'bill-2',
      category: 'billing',
      question: '¿Cómo configuro la facturación electrónica?',
      answer:
        'Ve a Finanzas → Activar facturación electrónica: carga tu certificado digital y tu resolución DIAN, y completa la habilitación. Después decides si las ventas del POS y de la tienda en línea se facturan automáticamente.',
    },
    {
      id: 'bill-3',
      category: 'billing',
      question: '¿Puedo facturar sin ser responsable de IVA?',
      answer:
        'Sí. Registra tus datos fiscales y las responsabilidades de tu RUT (puedes escanear el RUT en el asistente fiscal). Vendix ajusta las facturas según seas o no responsable de IVA.',
    },
    {
      id: 'bill-4',
      category: 'billing',
      question: '¿Cómo emito una nota crédito?',
      answer:
        'Desde la factura (o desde la orden ya facturada) elige "Nota crédito" e indica el motivo. Vendix la emite ante la DIAN con la numeración correspondiente y, si el cliente tiene correo, se la envía.',
    },
    {
      id: 'bill-5',
      category: 'billing',
      question: '¿Puedo conciliar los pagos con mi banco?',
      answer:
        'Sí. En Contabilidad → Conciliación bancaria registra tus cuentas, importa el extracto de tu banco (CSV, OFX o MT940) y concilia los movimientos de forma automática o manual.',
    },
    {
      id: 'bill-6',
      category: 'billing',
      question: '¿Qué pasa si una factura es rechazada por la DIAN?',
      answer:
        'La factura queda como "Rechazada" y en su detalle ves el mensaje de la DIAN. Puedes corregir los datos y reenviarla, dentro del plazo permitido, conservando su número.',
    },

    // ── Reports (5) ───────────────────────────────────────
    {
      id: 'rep-1',
      category: 'reports',
      question: '¿Qué reportes incluye Vendix?',
      answer:
        'Ventas por producto, categoría, cliente, canal, vendedor y método de pago, inventario valorizado, movimientos, reembolsos, arqueo de caja, reportes contables y más. Todos se exportan a Excel (XLSX).',
    },
    {
      id: 'rep-2',
      category: 'reports',
      question: '¿Puedo ver ventas en tiempo real?',
      answer:
        'El Panel Principal muestra ingresos, ganancias, tendencia, ventas por canal y alertas operativas (incluido el stock bajo) del periodo que elijas. Los pedidos nuevos te llegan como notificación al instante.',
    },
    {
      id: 'rep-3',
      category: 'reports',
      question: '¿Puedo programar el envío automático de reportes?',
      answer:
        'Por ahora no se pueden programar envíos de reportes por correo. Vendix genera automáticamente un informe semanal de tu tienda que puedes ver en el panel, y puedes descargar cualquier reporte en Excel cuando lo necesites.',
    },
    {
      id: 'rep-4',
      category: 'reports',
      question: '¿Cómo comparo ventas entre períodos?',
      answer:
        'Los reportes y analíticas de ventas muestran automáticamente la variación porcentual frente al periodo anterior equivalente.',
    },
    {
      id: 'rep-5',
      category: 'reports',
      question: '¿Puedo filtrar por vendedor, sucursal o canal?',
      answer:
        'Sí, con reportes dedicados por vendedor, por canal (en línea o POS), por método de pago y por categoría, todos filtrables por rango de fechas.',
    },

    // ── Users (5) ────────────────────────────────────────
    {
      id: 'usr-1',
      category: 'users',
      question: '¿Cómo creo un usuario y asigno permisos?',
      answer:
        'En Configuración → Usuarios crea el usuario con su nombre, correo, contraseña y rol. Los permisos del rol aplican de inmediato.',
    },
    {
      id: 'usr-2',
      category: 'users',
      question: '¿Qué roles incluye Vendix?',
      answer:
        'Propietario, Administrador, Gerente, Supervisor, Empleado y Cajero, cada uno con permisos predefinidos. Si necesitas otra combinación, crea un rol personalizado.',
    },
    {
      id: 'usr-3',
      category: 'users',
      question: '¿Puedo crear roles personalizados?',
      answer:
        'Sí. En Configuración → Roles crea un rol con su nombre y selecciona los permisos que tendrá. Útil para casos especiales como contador o auditor.',
    },
    {
      id: 'usr-4',
      category: 'users',
      question: '¿Cómo cambio el dueño de la tienda?',
      answer:
        'Para cambiar el propietario de la tienda, escríbenos desde Ayuda → Soporte y te acompañamos en el proceso.',
    },
    {
      id: 'usr-5',
      category: 'users',
      question: '¿Puedo limitar el acceso por horario?',
      answer:
        'Por ahora no es posible limitar el acceso por horario. Puedes desactivar usuarios o ajustar sus roles cuando lo necesites.',
    },

    // ── Shipping (5) ─────────────────────────────────────
    {
      id: 'ship-1',
      category: 'shipping',
      question: '¿Cómo configuro mis transportadoras?',
      answer:
        'En Despacho → Métodos de Envío configura tus opciones: transportadora o tercero, flota propia o recogida en tienda, con sus tiempos estimados y tarifas. Vendix no se conecta con las transportadoras para generar guías.',
    },
    {
      id: 'ship-2',
      category: 'shipping',
      question: '¿Puedo hacer envíos masivos?',
      answer:
        'Sí, en lote: selecciona varias órdenes o remisiones para imprimirlas, confirmarlas o marcarlas como entregadas, y agrúpalas en planillas de ruta.',
    },
    {
      id: 'ship-3',
      category: 'shipping',
      question: '¿Cómo calculo automáticamente el costo de envío?',
      answer:
        'En Despacho → Métodos de Envío configura zonas (por país, región o ciudad) y tarifas fijas, por peso, por valor del pedido o gratis. Al momento del checkout, Vendix calcula el costo según el destino.',
    },
    {
      id: 'ship-4',
      category: 'shipping',
      question: '¿Puedo ofrecer recogida en tienda?',
      answer:
        'Sí. Activa el método "Recogida en tienda" en Despacho → Métodos de Envío. El cliente lo elige en el checkout y tú marcas el pedido como listo para recoger.',
    },
    {
      id: 'ship-5',
      category: 'shipping',
      question: '¿Cómo rastreo un envío?',
      answer:
        'Al marcar la orden como enviada, registra el número de guía y la transportadora. Para entregas con flota propia, sigue el recorrido desde Despacho → Rutas.',
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

  /** Filtered FAQs.
   *  - No filter active → one representative question per
   *    category (a "preview" view, not a full dump). This keeps
   *    the FAQ section digestible: 6 questions instead of 34.
   *  - Any filter active (category or search) → full match
   *    list for the selected context.
   */
  readonly filteredFaqs = computed<FaqItem[]>(() => {
    const q = this.normalizedQuery();
    const cat = this.selectedCategory();

    // Filtered view: full match list
    if (q || cat) {
      return this.faqs().filter((f) => {
        if (cat && f.category !== cat) return false;
        if (q) {
          const haystack = `${f.question} ${f.answer}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });
    }

    // Preview view: first question per category (6 cards)
    const seen = new Set<FaqItem['category']>();
    return this.faqs().filter((f) => {
      if (seen.has(f.category)) return false;
      seen.add(f.category);
      return true;
    });
  });

  /** Counts for the active filter — used in section headings to
   *  show "(3)" after the title when a filter is active. */
  readonly filteredCategoryCount = computed(() => this.filteredCategories().length);
  readonly filteredFaqCount = computed(() => this.filteredFaqs().length);

  /** Toggle a category chip on/off. Clicking the same chip again
   *  clears the filter. When activating, smooth-scroll to the FAQ
   *  section so the user sees the filtered results immediately. */
  selectCategory(id: FaqItem['category']): void {
    const wasActive = this.selectedCategory() === id;
    this.selectedCategory.update((current) => (current === id ? null : id));
    if (!wasActive) {
      // Wait one frame so the filtered DOM is in place, then scroll
      // smoothly to the FAQ list. offsetTop accounts for the sticky
      // topbar (h-14 ≈ 56px) so the heading isn't hidden under it.
      setTimeout(() => {
        const el = this.faqSectionRef?.nativeElement;
        if (el) {
          const top = el.getBoundingClientRect().top + window.scrollY - 72;
          window.scrollTo({ top, behavior: 'smooth' });
        }
      }, 50);
    }
  }

  /** Clear all active filters at once. */
  clearAllFilters(): void {
    this.searchQuery.set('');
    this.selectedCategory.set(null);
  }
}
