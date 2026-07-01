import { Component, signal, computed, inject, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { PublicHeaderComponent } from '../components/public-header/public-header.component';

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
        'Ve a Inventario → Productos → Nuevo. Completa nombre, SKU, precio, stock inicial y al menos una imagen. Guarda y el producto aparece inmediatamente en tu catálogo online y en el POS.',
    },
    {
      id: 'inv-2',
      category: 'inventory',
      question: '¿Puedo gestionar varias bodegas?',
      answer:
        'Sí. En Configuración → Bodegas crea las bodegas que necesites. Cada producto puede tener stock por bodega y Vendix calcula el stock total automáticamente. Útil para manejar tienda física, depósito y tienda online por separado.',
    },
    {
      id: 'inv-3',
      category: 'inventory',
      question: '¿Cómo hago ajustes de inventario masivos?',
      answer:
        'En Inventario → Productos selecciona varios productos (checkbox a la izquierda) y usa "Acción en lote" para cambiar precio, categoría o estado de todos a la vez. Para ajustes de stock usa el módulo de Movimientos.',
    },
    {
      id: 'inv-4',
      category: 'inventory',
      question: '¿Qué pasa cuando un producto se queda sin stock?',
      answer:
        'El producto se marca automáticamente como "Agotado" y se oculta del catálogo público. Si tienes activado el modo "permitir ventas sin stock", Vendix seguirá aceptando pedidos pero te avisará para hacer reposición.',
    },
    {
      id: 'inv-5',
      category: 'inventory',
      question: '¿Puedo importar productos desde un Excel?',
      answer:
        'Sí. En Inventario → Productos → Importar sube tu archivo CSV o Excel. Vendix detecta automáticamente las columnas y mapea con las del sistema. Si hay errores, te los muestra antes de confirmar la importación.',
    },
    {
      id: 'inv-6',
      category: 'inventory',
      question: '¿Cómo veo el historial de movimientos de un producto?',
      answer:
        'En la ficha del producto, ve a la pestaña "Movimientos" para ver entradas, salidas, transferencias y ajustes con fecha, usuario responsable y motivo.',
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
        'Sí. En Configuración → Dominio conecta tu dominio propio (ej. mitienda.com). Vendix te da los nameservers para apuntar y el certificado SSL se configura automáticamente.',
    },
    {
      id: 'store-3',
      category: 'online-store',
      question: '¿Qué métodos de pago aceptan?',
      answer:
        'MercadoPago, Nequi, Daviplata, PSE, tarjetas crédito/débito (Visa, Mastercard, Amex), transferencia bancaria, pago contra entrega y efectivo en punto físico. La integración es automática, solo activas los que quieras ofrecer.',
    },
    {
      id: 'store-4',
      category: 'online-store',
      question: '¿Cómo personalizo el diseño de mi tienda?',
      answer:
        'En Tienda Online → Tema puedes elegir entre varios templates y ajustar colores, tipografías, banners y secciones. Todo se previsualiza en vivo antes de publicar.',
    },
    {
      id: 'store-5',
      category: 'online-store',
      question: '¿Cómo creo cupones de descuento?',
      answer:
        'En Marketing → Cupones define un código, tipo de descuento (% o monto fijo), vigencia, monto mínimo y límites de uso. Se aplican automáticamente en el checkout.',
    },
    {
      id: 'store-6',
      category: 'online-store',
      question: '¿Puedo vender sin tener tienda física?',
      answer:
        'Por supuesto. Muchos de nuestros clientes son 100% online. Vendix incluye la pasarela de pagos, el catálogo público y la gestión de envíos sin que necesites un local físico.',
    },
    {
      id: 'store-7',
      category: 'online-store',
      question: '¿Cómo funciona el checkout?',
      answer:
        'El cliente agrega productos al carrito, llena sus datos, elige método de pago y envío, y confirma. El pedido entra automáticamente a tu panel de órdenes y al inventario. Recibirás una notificación por email.',
    },

    // ── Billing (6) ──────────────────────────────────────
    {
      id: 'bill-1',
      category: 'billing',
      question: '¿Cuánto cuesta Vendix?',
      answer:
        'Durante el periodo de acceso anticipado, todas las funcionalidades están incluidas sin costo. Cuando lancemos los planes pagos, publicaremos los precios en esta misma página y por correo a todos los usuarios activos.',
    },
    {
      id: 'bill-2',
      category: 'billing',
      question: '¿Cómo configuro la facturación electrónica?',
      answer:
        'En Configuración → Facturación electrónica sube tu resolución DIAN, rango de numeración y certificado digital. Vendix genera automáticamente las facturas con cada venta válida.',
    },
    {
      id: 'bill-3',
      category: 'billing',
      question: '¿Puedo facturar sin ser responsable de IVA?',
      answer:
        'Sí. Configura tu perfil de empresa en Facturación → Perfil. Vendix ajusta las facturas según tu régimen (simplificado, común, gran contribuyente) automáticamente.',
    },
    {
      id: 'bill-4',
      category: 'billing',
      question: '¿Cómo emito una nota crédito?',
      answer:
        'En la orden original, haz clic en "Emitir nota crédito" e ingresa el motivo. Vendix genera el documento con la numeración correcta y lo notifica al cliente por email.',
    },
    {
      id: 'bill-5',
      category: 'billing',
      question: '¿Puedo conciliar los pagos con mi banco?',
      answer:
        'Vendix genera un archivo de conciliación con las transacciones diarias en el formato de tu banco. Configura los datos bancarios en Facturación → Conciliación y descárgalo cuando lo necesites.',
    },
    {
      id: 'bill-6',
      category: 'billing',
      question: '¿Qué pasa si una factura es rechazada por la DIAN?',
      answer:
        'La factura queda marcada como "Rechazada" y se generan los eventos correspondientes. Recibirás un email con el motivo. Puedes corregir los datos y reintentarlo sin afectar la numeración.',
    },

    // ── Reports (5) ───────────────────────────────────────
    {
      id: 'rep-1',
      category: 'reports',
      question: '¿Qué reportes incluye Vendix?',
      answer:
        'Ventas por período, top productos, ventas por categoría, ventas por vendedor, inventario valorizado, flujo de caja, devoluciones y muchos más. Todos exportables a Excel o PDF.',
    },
    {
      id: 'rep-2',
      category: 'reports',
      question: '¿Puedo ver ventas en tiempo real?',
      answer:
        'Sí. El Dashboard principal se actualiza cada 5 minutos. Las ventas del día, ticket promedio, productos más vendidos y alertas de stock se actualizan automáticamente.',
    },
    {
      id: 'rep-3',
      category: 'reports',
      question: '¿Puedo programar el envío automático de reportes?',
      answer:
        'En Reportes → Programados configura reportes recurrentes (diarios, semanales, mensuales) y los destinatarios que los reciben por email. Útil para equipos administrativos.',
    },
    {
      id: 'rep-4',
      category: 'reports',
      question: '¿Cómo comparo ventas entre períodos?',
      answer:
        'En cualquier reporte de ventas selecciona dos rangos de fechas y haz clic en "Comparar". El sistema te muestra la variación % y absoluta para cada métrica.',
    },
    {
      id: 'rep-5',
      category: 'reports',
      question: '¿Puedo filtrar por vendedor, sucursal o canal?',
      answer:
        'Sí. Todos los reportes tienen filtros por dimensiones: vendedor, sucursal, canal de venta (online/POS), método de pago, categoría y más. Los filtros se pueden combinar y guardar como vista recurrente.',
    },

    // ── Users (5) ────────────────────────────────────────
    {
      id: 'usr-1',
      category: 'users',
      question: '¿Cómo creo un usuario y asigno permisos?',
      answer:
        'En Equipo → Usuarios → Nuevo. Ingresa nombre, email y rol. El sistema envía un email de invitación con un link para que el usuario configure su contraseña. Los permisos del rol se asignan al crear.',
    },
    {
      id: 'usr-2',
      category: 'users',
      question: '¿Qué roles incluye Vendix?',
      answer:
        'Owner (acceso total), Administrador, Vendedor, Cajero, Inventarista y personalizado. Cada rol tiene permisos predefinidos que puedes ajustar granularmente.',
    },
    {
      id: 'usr-3',
      category: 'users',
      question: '¿Puedo crear roles personalizados?',
      answer:
        'Sí. En Equipo → Roles → Nuevo rol defines un nombre y seleccionas los permisos específicos que ese rol tendrá. Útil para casos especiales como contador o auditor.',
    },
    {
      id: 'usr-4',
      category: 'users',
      question: '¿Cómo cambio el dueño de la tienda?',
      answer:
        'El owner actual debe transferir la propiedad desde Equipo → Miembros → Owner → "Transferir propiedad". El nuevo owner debe aceptar por email. Por seguridad, ambos reciben una confirmación.',
    },
    {
      id: 'usr-5',
      category: 'users',
      question: '¿Puedo limitar el acceso por horario?',
      answer:
        'Sí. En Equipo → Configuración define horarios permitidos por usuario. Si alguien intenta entrar fuera de su horario, recibe un mensaje y se le bloquea el acceso hasta el siguiente período permitido.',
    },

    // ── Shipping (5) ─────────────────────────────────────
    {
      id: 'ship-1',
      category: 'shipping',
      question: '¿Cómo configuro mis transportadoras?',
      answer:
        'En Despachos → Configuración → Transportadoras agrega cada una con su API key. Vendix se conecta con las principales transportadoras colombianas para generar guías automáticamente.',
    },
    {
      id: 'ship-2',
      category: 'shipping',
      question: '¿Puedo hacer envíos masivos?',
      answer:
        'Sí. Selecciona varias órdenes pendientes en Despachos → Por despachar y haz clic en "Generar guías en lote". El sistema genera las guías de cada transportadora y actualiza las órdenes.',
    },
    {
      id: 'ship-3',
      category: 'shipping',
      question: '¿Cómo calculo automáticamente el costo de envío?',
      answer:
        'Configura zonas de envío en Despachos → Zonas con rangos de peso y destino. Al momento del checkout, Vendix calcula el costo según el destino y peso del pedido.',
    },
    {
      id: 'ship-4',
      category: 'shipping',
      question: '¿Puedo ofrecer recogida en tienda?',
      answer:
        'Sí. Activa "Recogida en tienda" en Despachos → Configuración. Los clientes eligen en el checkout y reciben un email con la dirección y horarios cuando el pedido está listo.',
    },
    {
      id: 'ship-5',
      category: 'shipping',
      question: '¿Cómo rastreo un envío?',
      answer:
        'En la orden, haz clic en "Rastrear envío". Vendix consulta el estado actualizado en tiempo real a la transportadora y muestra la línea de tiempo del paquete hasta la entrega.',
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
