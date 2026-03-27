# Sidebar

Barra lateral de navegacion con soporte para menus anidados (submenus), colapsado en desktop, drawer en mobile, y accesibilidad completa.

## Uso

```typescript
import { MenuItem } from './sidebar.component';

menuItems: MenuItem[] = [
  { label: 'Dashboard', icon: 'layout-dashboard', route: '/dashboard' },
  {
    label: 'Inventario',
    icon: 'package',
    children: [
      { label: 'Productos', route: '/products' },
      { label: 'Categorias', route: '/categories' },
    ],
  },
  { label: 'Reportes', icon: 'bar-chart-2', badge: '3' },
];
```

```html
<app-sidebar [menuItems]="menuItems" [title]="'Mi Tienda'" [vlink]="'mi-tienda'" [logoUrl]="storeLogo" [collapsed]="sidebarCollapsed" [isOpen]="sidebarOpen" [showFooter]="true" [isVendixDomain]="false" (expandSidebar)="onExpandSidebar()">
  <div slot="footer" class="p-4">
    <app-version></app-version>
  </div>
</app-sidebar>
```

## Inputs

| Input          | Tipo       | Default       | Descripcion                                 |
| -------------- | ---------- | ------------- | ------------------------------------------- |
| menuItems      | MenuItem[] | []            | Items del menu (ver interfaz abajo)         |
| title          | string     | 'Vendix Corp' | Nombre de la organizacion en el header      |
| vlink          | string     | 'vlink-slug'  | Slug del storefront (se construye como URL) |
| domainHostname | string     | null          | Hostname completo del dominio (opcional)    |
| logoUrl        | string     | null          | URL del logo de la tienda                   |
| collapsed      | boolean    | false         | Modo colapsado (solo iconos, para desktop)  |
| isOpen         | boolean    | false         | Control de visibilidad en mobile (drawer)   |
| showFooter     | boolean    | false         | Mostrar slot para footer                    |
| isVendixDomain | boolean    | false         | Activa tooltip promocional en el vlink      |
| shimmer        | boolean    | false         | Activa efecto shimmer en el sidebar         |

## Outputs

| Output        | Tipo         | Descripcion                                                                                   |
| ------------- | ------------ | --------------------------------------------------------------------------------------------- |
| expandSidebar | EventEmitter | Emite cuando se hace click en un submenu mientras esta colapsado (indica que debe expandirse) |

## Interfaz MenuItem

```typescript
interface MenuItem {
  label: string;
  icon: string;
  iconSize?: number | string;
  route?: string;
  children?: MenuItem[];
  badge?: string;
  action?: (item: MenuItem) => void;
  alwaysVisible?: boolean; // Ignora filtro de panel_ui
}
```

## Importante

- El sidebar es responsive: en mobile se convierte en un drawer con backdrop y lock de scroll; en desktop puede colapsar a iconos.
- Los submenus usan comportamiento accordion exclusivo (solo uno abierto a la vez).
- El tooltip promocional para dominios Vendix (`isVendixDomain`) se muestra automaticamente al montar y se oculta tras 5s.
- La navegacion de submenus auto-navega al primer hijo con ruta valida.
- El slot `<ng-content select="[slot=footer]"></ng-content>` permite inyectar contenido en el footer.
- `alwaysVisible: true` en un MenuItem hace que se ignore el filtro de `panel_ui` (para datos dinamicos como tiendas).
- El scroll del body se bloquea cuando el drawer mobile esta abierto.
