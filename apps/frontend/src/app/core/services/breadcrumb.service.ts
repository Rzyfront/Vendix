import { Injectable } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { BehaviorSubject } from 'rxjs';

export interface BreadcrumbItem {
  label: string;
  url?: string;
  icon?: string;
}

export interface BreadcrumbRoute {
  path: string;
  title: string;
  parent?: string;
  icon?: string;
}

@Injectable({
  providedIn: 'root',
})
export class BreadcrumbService {
  private breadcrumbSubject = new BehaviorSubject<{
    parent?: BreadcrumbItem;
    current: BreadcrumbItem;
    title: string;
  }>({
    title: 'Panel Principal',
    current: { label: 'Dashboard' },
  });

  breadcrumb$ = this.breadcrumbSubject.asObservable();

  private routes: BreadcrumbRoute[] = [
    // Dashboard
    { path: '/dashboard', title: 'Dashboard', icon: 'home' },
    { path: '/', title: 'Dashboard', icon: 'home' },

    // Organization Admin Dashboard
    {
      path: '/organization/dashboard',
      title: 'Panel Principal',
      parent: 'Organización',
      icon: 'home',
    },
    { path: '/organization', title: 'Organización', icon: 'store' },

    // Store Admin Dashboard
    {
      path: '/store/dashboard',
      title: 'Panel Principal',
      parent: 'Tienda',
      icon: 'home',
    },
    { path: '/store', title: 'Tienda', icon: 'cart' },

    // Organizaciones
    { path: '/organizations', title: 'Organizaciones', icon: 'store' },
    {
      path: '/organization/analytics',
      title: 'Análisis',
      icon: 'chart-line',
      parent: 'Organizaciones',
    },
    {
      path: '/organization/analytics/reports',
      title: 'Reportes',
      parent: 'Analytics',
    },
    {
      path: '/organization/analytics/statistics',
      title: 'Estadísticas',
      parent: 'Analytics',
    },
    {
      path: '/organization/analytics/insights',
      title: 'Perspectivas',
      parent: 'Analytics',
    },
    {
      path: '/organization/users',
      title: 'Usuarios',
      icon: 'users',
      parent: 'Organizaciones',
    },
    {
      path: '/organization/users/all',
      title: 'Todos los Usuarios',
      parent: 'Usuarios',
    },
    { path: '/organization/users/roles', title: 'Roles', parent: 'Usuarios' },
    {
      path: '/organization/users/permissions',
      title: 'Permisos',
      parent: 'Usuarios',
    },
    {
      path: '/organization/products',
      title: 'Productos',
      icon: 'package',
      parent: 'Organizaciones',
    },
    {
      path: '/organization/products/all',
      title: 'Todos los Productos',
      parent: 'Productos',
    },
    {
      path: '/organization/products/categories',
      title: 'Categorías',
      parent: 'Productos',
    },
    {
      path: '/organization/products/inventory',
      title: 'Inventario',
      parent: 'Productos',
    },
    {
      path: '/organization/orders',
      title: 'Pedidos',
      icon: 'credit-card',
      parent: 'Organizaciones',
    },
    {
      path: '/organization/settings',
      title: 'Configuración',
      icon: 'settings',
      parent: 'Organizaciones',
    },
    {
      path: '/organization/settings/general',
      title: 'General',
      parent: 'Configuración',
    },
    {
      path: '/organization/settings/security',
      title: 'Seguridad',
      parent: 'Configuración',
    },
    {
      path: '/organization/settings/notifications',
      title: 'Notificaciones',
      parent: 'Configuración',
    },

    // Usuarios
    { path: '/users', title: 'Usuarios', icon: 'user' },
    { path: '/users/create', title: 'Crear Usuario', parent: 'Usuarios' },
    { path: '/users/:id', title: 'Detalles', parent: 'Usuarios' },
    { path: '/users/:id/edit', title: 'Editar', parent: 'Usuarios' },

    // Tiendas
    { path: '/stores', title: 'Tiendas', icon: 'cart' },
    { path: '/stores/create', title: 'Crear Tienda', parent: 'Tiendas' },
    { path: '/stores/:id', title: 'Detalles', parent: 'Tiendas' },
    { path: '/stores/:id/edit', title: 'Editar', parent: 'Tiendas' },

    // Productos
    { path: '/products', title: 'Productos', icon: 'package' },
    { path: '/products/create', title: 'Crear Producto', parent: 'Productos' },
    { path: '/products/:id', title: 'Detalles', parent: 'Productos' },
    { path: '/products/:id/edit', title: 'Editar', parent: 'Productos' },
    { path: '/products/categories', title: 'Categorías', parent: 'Productos' },

    // Pedidos
    { path: '/orders', title: 'Orders', icon: 'credit-card' },
    { path: '/orders/:id', title: 'Order Details', parent: 'Orders' },
    {
      path: '/admin/orders',
      title: 'Orders',
      icon: 'credit-card',
      parent: 'Organización',
    },
    {
      path: '/admin/orders/:id',
      title: 'Order Details',
      parent: 'Orders',
    },

    // Configuración
    { path: '/settings', title: 'Configuración', icon: 'settings' },
    { path: '/settings/profile', title: 'Mi Perfil', parent: 'Configuración' },
    { path: '/settings/security', title: 'Seguridad', parent: 'Configuración' },
    {
      path: '/settings/notifications',
      title: 'Notificaciones',
      parent: 'Configuración',
    },

    // Reportes
    { path: '/reports', title: 'Reportes', icon: 'chart-line' },
    { path: '/reports/sales', title: 'Reportes de Ventas', parent: 'Reportes' },
    { path: '/reports/inventory', title: 'Inventario', parent: 'Reportes' },
    { path: '/reports/customers', title: 'Clientes', parent: 'Reportes' },

    // Soporte
    { path: '/support', title: 'Soporte', icon: 'headset' },
    {
      path: '/support/tickets',
      title: 'Tickets de Soporte',
      parent: 'Soporte',
    },
    { path: '/support/faq', title: 'FAQ', parent: 'Soporte' },

    // Super Admin
    { path: '/super-admin', title: 'Super Admin', icon: 'settings' },
    {
      path: '/super-admin/dashboard',
      title: 'Panel Principal',
      parent: 'Super Admin',
      icon: 'home',
    },
    {
      path: '/super-admin/organizations',
      title: 'Organizaciones',
      parent: 'Super Admin',
      icon: 'store',
    },
    {
      path: '/super-admin/organizations/create',
      title: 'Crear Organización',
      parent: 'Organizaciones',
    },
    {
      path: '/super-admin/organizations/:id',
      title: 'Detalles',
      parent: 'Organizaciones',
    },
    {
      path: '/super-admin/organizations/:id/edit',
      title: 'Editar',
      parent: 'Organizaciones',
    },
    {
      path: '/super-admin/users',
      title: 'Usuarios',
      parent: 'Super Admin',
      icon: 'users',
    },
    {
      path: '/super-admin/users/create',
      title: 'Crear Usuario',
      parent: 'Usuarios',
    },
    { path: '/super-admin/users/:id', title: 'Detalles', parent: 'Usuarios' },
    {
      path: '/super-admin/users/:id/edit',
      title: 'Editar',
      parent: 'Usuarios',
    },
    { path: '/super-admin/users/roles', title: 'Roles', parent: 'Usuarios' },
    {
      path: '/super-admin/users/permissions',
      title: 'Permisos',
      parent: 'Usuarios',
    },
    {
      path: '/super-admin/roles',
      title: 'Roles',
      parent: 'Super Admin',
      icon: 'shield',
    },
    {
      path: '/super-admin/stores',
      title: 'Tiendas',
      parent: 'Super Admin',
      icon: 'cart',
    },
    {
      path: '/super-admin/stores/create',
      title: 'Crear Tienda',
      parent: 'Tiendas',
    },
    { path: '/super-admin/stores/:id', title: 'Detalles', parent: 'Tiendas' },
    {
      path: '/super-admin/stores/:id/edit',
      title: 'Editar',
      parent: 'Tiendas',
    },
    {
      path: '/super-admin/products',
      title: 'Productos',
      parent: 'Super Admin',
      icon: 'package',
    },
    {
      path: '/super-admin/products/create',
      title: 'Crear Producto',
      parent: 'Productos',
    },
    {
      path: '/super-admin/products/:id',
      title: 'Detalles',
      parent: 'Productos',
    },
    {
      path: '/super-admin/products/:id/edit',
      title: 'Editar',
      parent: 'Productos',
    },
    {
      path: '/super-admin/orders',
      title: 'Pedidos',
      parent: 'Super Admin',
      icon: 'credit-card',
    },
    {
      path: '/super-admin/orders/:id',
      title: 'Detalles del Pedido',
      parent: 'Pedidos',
    },
    {
      path: '/super-admin/reports',
      title: 'Reportes',
      parent: 'Super Admin',
      icon: 'chart-line',
    },
    {
      path: '/super-admin/reports/sales',
      title: 'Reportes de Ventas',
      parent: 'Reportes',
    },
    {
      path: '/super-admin/reports/analytics',
      title: 'Análisis',
      parent: 'Reportes',
    },
    {
      path: '/super-admin/settings',
      title: 'Configuración',
      parent: 'Super Admin',
      icon: 'settings',
    },
    {
      path: '/super-admin/settings/general',
      title: 'General',
      parent: 'Configuración',
    },
    {
      path: '/super-admin/settings/security',
      title: 'Seguridad',
      parent: 'Configuración',
    },
    {
      path: '/super-admin/settings/system',
      title: 'Sistema',
      parent: 'Configuración',
    },
    {
      path: '/super-admin/domains',
      title: 'Dominios',
      parent: 'Super Admin',
      icon: 'globe-2',
    },
    {
      path: '/super-admin/audit',
      title: 'Auditoría',
      parent: 'Super Admin',
      icon: 'eye',
    },

    // Admin - Organization Admin Routes
    { path: '/admin', title: 'Panel Administrativo', icon: 'settings' },
    {
      path: '/admin/dashboard',
      title: 'Panel Principal',
      parent: 'Panel Administrativo',
      icon: 'home',
    },

    // Financial
    {
      path: '/admin/financial',
      title: 'Finanzas',
      parent: 'Panel Administrativo',
      icon: 'dollar-sign',
    },
    {
      path: '/admin/financial/reports',
      title: 'Reportes',
      parent: 'Financial',
      icon: 'file-text',
    },
    {
      path: '/admin/financial/billing',
      title: 'Facturación y Suscripciones',
      parent: 'Financial',
      icon: 'credit-card',
    },
    {
      path: '/admin/financial/cost-analysis',
      title: 'Análisis de Costos',
      parent: 'Financial',
      icon: 'bar-chart',
    },
    {
      path: '/admin/financial/cash-flow',
      title: 'Flujo de Caja',
      parent: 'Financial',
      icon: 'trending-up',
    },

    // Analytics & BI
    {
      path: '/admin/analytics',
      title: 'Análisis e Inteligencia de Negocios',
      parent: 'Panel Administrativo',
      icon: 'chart-line',
    },
    {
      path: '/admin/analytics/predictive',
      title: 'Análisis Predictivo',
      parent: 'Analytics & BI',
      icon: 'bar-chart',
    },
    {
      path: '/admin/analytics/cross-store',
      title: 'Análisis Multi-Tienda',
      parent: 'Analytics & BI',
      icon: 'store',
    },

    // Stores Management
    {
      path: '/admin/stores-management',
      title: 'Tiendas',
      parent: 'Panel Administrativo',
      icon: 'store',
    },

    // Users Management
    {
      path: '/admin/users',
      title: 'Usuarios',
      parent: 'Panel Administrativo',
      icon: 'users',
    },
    {
      path: '/admin/users/global-users',
      title: 'Usuarios Globales',
      parent: 'Users',
      icon: 'user',
    },
    {
      path: '/admin/users/roles-permissions',
      title: 'Roles y Permisos',
      parent: 'Users',
      icon: 'shield',
    },
    {
      path: '/admin/users/store-assignments',
      title: 'Asignaciones de Tienda',
      parent: 'Users',
      icon: 'building',
    },
    {
      path: '/admin/users/access-audit',
      title: 'Auditoría de Acceso',
      parent: 'Users',
      icon: 'eye',
    },

    // Inventory
    {
      path: '/admin/inventory',
      title: 'Inventario',
      parent: 'Panel Administrativo',
      icon: 'warehouse',
    },
    {
      path: '/admin/inventory/stock',
      title: 'Gestión de Stock',
      parent: 'Inventory',
      icon: 'package',
    },
    {
      path: '/admin/inventory/transfers',
      title: 'Transferencias de Stock',
      parent: 'Inventory',
      icon: 'refresh-ccw',
    },
    {
      path: '/admin/inventory/suppliers',
      title: 'Proveedores',
      parent: 'Inventory',
      icon: 'truck',
    },
    {
      path: '/admin/inventory/demand-forecast',
      title: 'Pronóstico de Demanda',
      parent: 'Inventory',
      icon: 'trending-up',
    },

    // Operations
    {
      path: '/admin/operations',
      title: 'Operaciones',
      parent: 'Panel Administrativo',
      icon: 'truck',
    },
    {
      path: '/admin/operations/shipping',
      title: 'Gestión de Envíos',
      parent: 'Operations',
      icon: 'truck',
    },
    {
      path: '/admin/operations/procurement',
      title: 'Adquisiciones',
      parent: 'Operations',
      icon: 'cart',
    },
    {
      path: '/admin/operations/returns',
      title: 'Gestión de Devoluciones',
      parent: 'Operations',
      icon: 'rotate-ccw',
    },
    {
      path: '/admin/operations/route-optimization',
      title: 'Optimización de Rutas',
      parent: 'Operations',
      icon: 'globe-2',
    },

    // Audit & Compliance
    {
      path: '/admin/audit',
      title: 'Auditoría y Cumplimiento',
      parent: 'Panel Administrativo',
      icon: 'shield',
    },
    {
      path: '/admin/audit/logs',
      title: 'Registros de Auditoría',
      parent: 'Audit & Compliance',
      icon: 'file-text',
    },
    {
      path: '/admin/audit/compliance',
      title: 'Reportes de Cumplimiento',
      parent: 'Audit & Compliance',
      icon: 'file-check',
    },
    {
      path: '/admin/audit/legal-docs',
      title: 'Documentos Legales',
      parent: 'Audit & Compliance',
      icon: 'file-text',
    },
    {
      path: '/admin/audit/backup',
      title: 'Respaldo y Recuperación',
      parent: 'Audit & Compliance',
      icon: 'backup',
    },

    // Configuration
    {
      path: '/admin/config',
      title: 'Configuración',
      parent: 'Panel Administrativo',
      icon: 'settings',
    },
    {
      path: '/admin/config/application',
      title: 'Configuración de Aplicación',
      parent: 'Configuration',
      icon: 'sliders',
    },
    {
      path: '/admin/config/policies',
      title: 'Políticas',
      parent: 'Configuration',
      icon: 'file-text',
    },
    {
      path: '/admin/config/integrations',
      title: 'Integraciones',
      parent: 'Configuration',
      icon: 'link-2',
    },
    {
      path: '/admin/config/taxes',
      title: 'Impuestos',
      parent: 'Configuration',
      icon: 'credit-card',
    },
    {
      path: '/admin/config/domains',
      title: 'Dominios',
      parent: 'Configuration',
      icon: 'globe-2',
    },

    // Store Admin Routes
    { path: '/store', title: 'Tienda', icon: 'store' },
    {
      path: '/store/dashboard',
      title: 'Panel Principal',
      parent: 'Tienda',
      icon: 'home',
    },

    // Products
    {
      path: '/store/products',
      title: 'Productos',
      parent: 'Tienda',
      icon: 'package',
    },
    {
      path: '/store/products/all',
      title: 'Todos los Productos',
      parent: 'Products',
      icon: 'package',
    },
    {
      path: '/store/products/categories',
      title: 'Categorías',
      parent: 'Products',
      icon: 'tag',
    },
    {
      path: '/store/products/inventory',
      title: 'Inventario',
      parent: 'Products',
      icon: 'archive',
    },

    // Orders
    {
      path: '/store/orders',
      title: 'Pedidos',
      parent: 'Tienda',
      icon: 'clipboard-list',
    },
    {
      path: '/store/orders/list',
      title: 'Lista de Pedidos',
      parent: 'Orders',
      icon: 'list',
    },
    {
      path: '/store/orders/:id',
      title: 'Detalles del Pedido',
      parent: 'Orders',
      icon: 'eye',
    },

    // Customers
    {
      path: '/store/customers',
      title: 'Clientes',
      parent: 'Tienda',
      icon: 'users',
    },
    {
      path: '/store/customers/all',
      title: 'Todos los Clientes',
      parent: 'Customers',
      icon: 'users',
    },
    {
      path: '/store/customers/:id',
      title: 'Detalles del Cliente',
      parent: 'Customers',
      icon: 'user',
    },
    {
      path: '/store/customers/reviews',
      title: 'Reseñas de Clientes',
      parent: 'Customers',
      icon: 'star',
    },

    // Marketing
    {
      path: '/store/marketing',
      title: 'Mercadeo',
      parent: 'Tienda',
      icon: 'bullhorn',
    },
    {
      path: '/store/marketing/promotions',
      title: 'Promociones',
      parent: 'Marketing',
      icon: 'gift',
    },
    {
      path: '/store/marketing/coupons',
      title: 'Cupones',
      parent: 'Marketing',
      icon: 'ticket',
    },

    // Analytics
    {
      path: '/store/analytics',
      title: 'Análisis',
      parent: 'Tienda',
      icon: 'chart-line',
    },
    {
      path: '/store/analytics/sales',
      title: 'Análisis de Ventas',
      parent: 'Analytics',
      icon: 'dollar-sign',
    },
    {
      path: '/store/analytics/traffic',
      title: 'Análisis de Tráfico',
      parent: 'Analytics',
      icon: 'globe',
    },
    {
      path: '/store/analytics/performance',
      title: 'Rendimiento',
      parent: 'Analytics',
      icon: 'trending-up',
    },

    // Settings
    {
      path: '/store/settings',
      title: 'Configuración',
      parent: 'Tienda',
      icon: 'cog',
    },
    {
      path: '/store/settings/general',
      title: 'Configuración General',
      parent: 'Settings',
      icon: 'cog',
    },
    {
      path: '/store/settings/appearance',
      title: 'Apariencia',
      parent: 'Settings',
      icon: 'palette',
    },
    {
      path: '/store/settings/security',
      title: 'Seguridad',
      parent: 'Settings',
      icon: 'shield',
    },

    // POS (Point of Sale)
    {
      path: '/store/pos',
      title: 'Punto de Venta',
      parent: 'Tienda',
      icon: 'cash-register',
    },
    {
      path: '/store/pos/register',
      title: 'Registro POS',
      parent: 'Point of Sale',
      icon: 'register',
    },
    {
      path: '/store/pos/cart',
      title: 'Carrito POS',
      parent: 'Point of Sale',
      icon: 'shopping-cart',
    },
    {
      path: '/store/pos/payment',
      title: 'Pago POS',
      parent: 'Point of Sale',
      icon: 'credit-card',
    },
  ];

  constructor(private router: Router) {
    this.initializeBreadcrumb();
  }

  private initializeBreadcrumb() {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.updateBreadcrumb(event.urlAfterRedirects);
      });

    // Inicializar con la ruta actual
    this.updateBreadcrumb(this.router.url);
  }

  private updateBreadcrumb(url: string) {
    const cleanUrl = url.split('?')[0];
    const routeData = this.findRouteMatch(cleanUrl);

    if (routeData) {
      const breadcrumb = {
        title: routeData.title,
        parent: routeData.parent
          ? {
              label: routeData.parent,
              url: this.getParentUrl(routeData),
              icon: this.getParentIcon(routeData),
            }
          : undefined,
        current: {
          label: routeData.title,
          icon: routeData.icon,
        },
      };

      this.breadcrumbSubject.next(breadcrumb);
    } else {
      // Breadcrumb por defecto si no hay coincidencia
      const defaultBreadcrumb = {
        title: 'Panel Principal',
        parent: undefined,
        current: {
          label: 'Dashboard',
          icon: 'home',
        },
      };
      this.breadcrumbSubject.next(defaultBreadcrumb);
    }
  }

  private findRouteMatch(url: string): BreadcrumbRoute | null {
    // Primero buscar coincidencia exacta
    let route = this.routes.find((r) => r.path === url);
    if (route) return route;

    // Luego buscar rutas con parámetros
    for (const routePattern of this.routes) {
      if (this.matchesRoute(url, routePattern.path)) {
        return routePattern;
      }
    }

    return null;
  }

  private matchesRoute(url: string, pattern: string): boolean {
    const urlParts = url.split('/').filter((p) => p);
    const patternParts = pattern.split('/').filter((p) => p);

    if (urlParts.length !== patternParts.length) {
      return false;
    }

    return patternParts.every((part, index) => {
      return part.startsWith(':') || part === urlParts[index];
    });
  }

  private getParentUrl(route: BreadcrumbRoute): string | undefined {
    if (!route.parent) return undefined;

    // Para Super Admin: construir URL base
    if (route.path.startsWith('/super-admin/')) {
      return '/super-admin';
    }

    // Para Admin/Organization Admin: construir URL base
    if (route.path.startsWith('/admin/')) {
      return '/admin';
    }

    // Para Store Admin: construir URL base
    if (route.path.startsWith('/store/')) {
      return '/store';
    }

    // Para Organization Admin (legacy): construir URL base
    if (route.path.startsWith('/organization/')) {
      return '/organization';
    }

    // Para Store Admin: construir URL base
    if (route.path.startsWith('/store/')) {
      return '/store';
    }

    // Buscar la ruta del padre por título
    const parentRoute = this.routes.find((r) => r.title === route.parent);
    if (!parentRoute) return undefined;

    // Construir URL del padre basado en la URL actual
    const currentUrl = this.router.url.split('?')[0];
    const currentParts = currentUrl.split('/').filter((p) => p);
    const parentParts = parentRoute.path.split('/').filter((p) => p);

    // Si la ruta del padre tiene menos partes, construir URL reducida
    if (parentParts.length < currentParts.length) {
      return '/' + currentParts.slice(0, parentParts.length).join('/');
    }

    return parentRoute.path;
  }

  private getParentIcon(route: BreadcrumbRoute): string | undefined {
    if (!route.parent) return undefined;
    const parentRoute = this.routes.find((r) => r.title === route.parent);
    return parentRoute?.icon;
  }

  // Método para agregar rutas dinámicamente
  addRoute(route: BreadcrumbRoute) {
    this.routes.push(route);
    // Actualizar breadcrumb si estamos en esta ruta
    this.updateBreadcrumb(this.router.url);
  }

  // Método para remover rutas
  removeRoute(path: string) {
    this.routes = this.routes.filter((r) => r.path !== path);
  }

  // Obtener título de la página actual
  getCurrentTitle(): string {
    const current = this.breadcrumbSubject.value;
    return current.title;
  }

  // Navegar al padre si existe
  navigateToParent() {
    const parent = this.breadcrumbSubject.value.parent;
    if (parent?.url) {
      this.router.navigateByUrl(parent.url);
    }
  }

  // Actualizar título dinámicamente (útil para IDs de recursos)
  updateCurrentTitle(title: string, subtitle?: string) {
    const current = this.breadcrumbSubject.value;
    this.breadcrumbSubject.next({
      ...current,
      title: title,
      current: {
        ...current.current,
        label: subtitle || title,
      },
    });
  }
}
