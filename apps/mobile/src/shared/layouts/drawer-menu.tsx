import { useState, useMemo, useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Linking, Image, Alert, Animated, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/core/store/auth.store';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, typography, spacing, borderRadius } from '@/shared/theme';
import { useQuery } from '@tanstack/react-query';
import type { StoreListItem } from '@/core/models/org-admin/store.types';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastError } from '@/shared/components/toast/toast.store';

interface MenuItem {
  label: string;
  icon: string;
  href?: string;
  alwaysVisible?: boolean;
  requiredOperatingScope?: 'STORE' | 'ORGANIZATION';
  showLocked?: boolean;
  requiredFiscalScope?: 'STORE' | 'ORGANIZATION';
  requiresFiscalArea?: 'invoicing' | 'accounting' | 'payroll' | 'any';
  lockedTooltip?: string;
  _locked?: boolean;
  children?: MenuItem[];
  action?: () => void;
  lockedBadge?: string;
}

const baseOrgMenuItems: MenuItem[] = [
  { label: 'Panel Principal', icon: 'home', href: '/(org-admin)/dashboard' },
  {
    label: 'Tiendas',
    icon: 'store',
    children: [
      { label: 'Ver Todas las Tiendas', icon: 'list', href: '/(org-admin)/stores' },
    ],
  },
  { label: 'Usuarios', icon: 'users', href: '/(org-admin)/users' },
  {
    label: 'Inventario',
    icon: 'warehouse',
    children: [
      { 
        label: 'Compras', 
        icon: 'shopping-bag', 
        href: '/(org-admin)/purchase-orders',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible solo en modo ORGANIZATION. Selecciona una tienda.',
      },
      { 
        label: 'Niveles de Stock', 
        icon: 'package', 
        href: '/(org-admin)/inventory/stock-levels',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible solo en modo ORGANIZATION. Selecciona una tienda.',
      },
      { 
        label: 'Ubicaciones', 
        icon: 'map', 
        href: '/(org-admin)/inventory/locations',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible en modo ORGANIZATION',
      },
      { 
        label: 'Movimientos', 
        icon: 'activity', 
        href: '/(org-admin)/inventory/movements',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible en modo ORGANIZATION',
      },
      { 
        label: 'Proveedores', 
        icon: 'factory', 
        href: '/(org-admin)/inventory/suppliers',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible en modo ORGANIZATION',
      },
      { 
        label: 'Transferencias', 
        icon: 'truck', 
        href: '/(org-admin)/inventory/transfers',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible en modo ORGANIZATION',
      },
      { 
        label: 'Ajustes de Stock', 
        icon: 'sliders', 
        href: '/(org-admin)/inventory/adjustments',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible en modo ORGANIZATION',
      },
      { 
        label: 'Números de Serie', 
        icon: 'barcode', 
        href: '/(org-admin)/inventory/serial-numbers',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible en modo ORGANIZATION',
      },
      { 
        label: 'Lotes', 
        icon: 'layers', 
        href: '/(org-admin)/inventory/batches',
        alwaysVisible: true,
        requiredOperatingScope: 'ORGANIZATION',
        showLocked: true,
        lockedBadge: 'ORG',
        lockedTooltip: 'Disponible en modo ORGANIZATION',
      },
    ],
  },
  { label: 'Dominios', icon: 'globe', href: '/(org-admin)/domains' },
  { label: 'Roles', icon: 'shield', href: '/(org-admin)/roles' },
  {
    label: 'Auditoría y Cumplimiento',
    icon: 'eye',
    href: '/(org-admin)/audit',
  },
  {
    label: 'Reportes',
    icon: 'bar-chart',
    children: [
      { label: 'Ventas', icon: 'trending-up', href: '/(org-admin)/reports/sales', alwaysVisible: true },
      { label: 'Inventario', icon: 'package', href: '/(org-admin)/reports/inventory', alwaysVisible: true },
      { label: 'Financiero', icon: 'dollar-sign', href: '/(org-admin)/reports/financial', alwaysVisible: true },
    ],
  },
  {
    label: 'Fiscal',
    icon: 'landmark',
    alwaysVisible: true,
    requiredFiscalScope: 'ORGANIZATION',
    children: [
      { label: 'Operación fiscal', icon: 'clipboard-list', href: '/(org-admin)/fiscal', alwaysVisible: true, requiredFiscalScope: 'ORGANIZATION' },
      { label: 'Facturación', icon: 'receipt', href: '/(org-admin)/invoicing', alwaysVisible: true, requiredFiscalScope: 'ORGANIZATION', requiresFiscalArea: 'invoicing' },
      { label: 'Contabilidad', icon: 'book-open', href: '/(org-admin)/accounting', alwaysVisible: true, requiredFiscalScope: 'ORGANIZATION', requiresFiscalArea: 'accounting' },
      { label: 'Nómina', icon: 'banknote', href: '/(org-admin)/payroll', alwaysVisible: true, requiredFiscalScope: 'ORGANIZATION', requiresFiscalArea: 'payroll' },
    ],
  },
  {
    label: 'Configuración',
    icon: 'settings',
    href: '/(org-admin)/settings',
  },
];

const storeMenuItems: MenuItem[] = [
  { label: 'Panel Principal', icon: 'home', href: '/(store-admin)/dashboard' },
  { label: 'Punto de venta', icon: 'store', href: '/(store-admin)/pos' },
  { label: 'Órdenes', icon: 'shopping-cart', href: '/(store-admin)/orders' },
  { label: 'Productos', icon: 'package', href: '/(store-admin)/products' },
  {
    label: 'Inventario', icon: 'warehouse', href: '/(store-admin)/inventory/pop',
    children: [
      { label: 'Punto de Compra', icon: 'shopping-cart', href: '/(store-admin)/inventory/pop' },
      { label: 'Ajustes de Stock', icon: 'sliders', href: '/(store-admin)/inventory/adjustments' },
      { label: 'Transferencias', icon: 'truck', href: '/(store-admin)/inventory/transfers' },
      { label: 'Movimientos', icon: 'activity', href: '/(store-admin)/inventory/movements' },
      { label: 'Ubicaciones', icon: 'warehouse', href: '/(store-admin)/inventory/locations' },
      { label: 'Proveedores', icon: 'store', href: '/(store-admin)/inventory/suppliers' },
    ],
  },
  {
    label: 'Clientes', icon: 'users', href: '/(store-admin)/customers',
    children: [
      { label: 'Todos los Clientes', icon: 'users', href: '/(store-admin)/customers' },
      { label: 'Reseñas', icon: 'star', href: '/(store-admin)/customers/reviews' },
      { label: 'Recolección de Datos', icon: 'clipboard-list', href: '/(store-admin)/customers/data-collection/fields' },
    ],
  },
  { label: 'Tienda en línea', icon: 'shopping-bag', href: '/(store-admin)/online-store' },
  { label: 'Marketing', icon: 'megaphone', href: '/(store-admin)/marketing' },
  { label: 'Analíticas', icon: 'chart-line', href: '/(store-admin)/analytics' },
  { label: 'Gastos', icon: 'wallet', href: '/(store-admin)/expenses' },
  { label: 'Facturación', icon: 'file-text', href: '/(store-admin)/invoicing', alwaysVisible: true, requiredFiscalScope: 'STORE', requiresFiscalArea: 'invoicing' },
  { label: 'Contabilidad', icon: 'book-open', href: '/(store-admin)/accounting', alwaysVisible: true, requiredFiscalScope: 'STORE', requiresFiscalArea: 'accounting' },
  { label: 'Ayuda', icon: 'help-circle', href: '/(store-admin)/help' },
  { label: 'Configuración', icon: 'settings', href: '/(store-admin)/settings' },
];

const superMenuItems: MenuItem[] = [
  { label: 'Panel Principal', icon: 'home', href: '/(super-admin)/dashboard' },
  { label: 'Organizaciones', icon: 'building-2', href: '/(super-admin)/organizations' },
  { label: 'Tiendas', icon: 'store', href: '/(super-admin)/stores' },
  { label: 'Usuarios', icon: 'users', href: '/(super-admin)/users' },
  { label: 'Suscripciones', icon: 'credit-card', href: '/(super-admin)/subscriptions' },
  { label: 'AI Engine', icon: 'cpu', href: '/(super-admin)/ai-engine' },
  { label: 'Monitoreo', icon: 'activity', href: '/(super-admin)/monitoring' },
  { label: 'Configuración', icon: 'settings', href: '/(super-admin)/settings' },
];

const variantConfig = {
  store: { items: storeMenuItems, icon: 'store' as const, label: 'Tienda' },
  org: { items: baseOrgMenuItems, icon: 'building-2' as const, label: 'Organización' },
  super: { items: superMenuItems, icon: 'shield' as const, label: 'Vendix Admin' },
};

const moduleKeyMap: Record<string, string | string[]> = {
  // ORG_ADMIN mappings
  'Panel Principal': 'dashboard',
  Tiendas: 'stores',
  Usuarios: ['users', 'settings_users'],
  Roles: 'settings_roles',
  'Auditoría y Cumplimiento': 'audit',
  Compras: ['purchase_orders', 'orders_purchase_orders', 'orders'],
  Dominios: ['domains', 'settings_domains'],

  // STORE_ADMIN mappings
  Inventario: 'inventory',
  'Punto de venta': 'pos',
  'Punto de Venta': 'pos',
  Productos: 'products',
  'Tienda en línea': 'ecommerce',
  Órdenes: 'orders',
  Marketing: 'marketing',
  Analíticas: 'analytics',
  Gastos: 'expenses',
  Reportes: 'reports',
  Ayuda: 'help',
  Configuración: 'settings',

  // Fiscal sub-items
  Facturación: 'invoicing',
  Contabilidad: 'accounting',
  Nómina: 'payroll',
};

interface CollapsibleSubmenuProps {
  isExpanded: boolean;
  childrenCount: number;
  children: React.ReactNode;
}

function CollapsibleSubmenu({ isExpanded, childrenCount, children }: CollapsibleSubmenuProps) {
  const animatedHeight = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;
  const [shouldRender, setShouldRender] = useState(isExpanded);

  useEffect(() => {
    if (isExpanded) {
      setShouldRender(true);
      Animated.timing(animatedHeight, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(animatedHeight, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start(() => {
        setShouldRender(false);
      });
    }
  }, [isExpanded]);

  const height = animatedHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, childrenCount * 40], // 10+10 paddingVertical + 2 marginVertical + text height + extra buffer
  });

  if (!shouldRender && !isExpanded) return null;

  return (
    <Animated.View style={{ height, overflow: 'hidden' }}>
      {children}
    </Animated.View>
  );
}

interface SidebarButtonProps {
  onPress: () => void;
  isActive?: boolean;
  isLocked?: boolean;
  pressedStyle: any;
  activeStyle?: any;
  baseStyle: any;
  children: React.ReactNode;
}

function SidebarButton({
  onPress,
  isActive = false,
  isLocked = false,
  pressedStyle,
  activeStyle,
  baseStyle,
  children,
}: SidebarButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 0.97,
        useNativeDriver: true,
        speed: 50,
        bounciness: 0,
      }),
      Animated.timing(opacity, {
        toValue: 0.85,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1.0,
        useNativeDriver: true,
        speed: 40,
        bounciness: 4,
      }),
      Animated.timing(opacity, {
        toValue: 1.0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [
        baseStyle,
        isActive && activeStyle,
        pressed && pressedStyle,
        isLocked && styles.lockedItem,
      ]}
    >
      <Animated.View style={{ transform: [{ scale }], opacity, flexDirection: 'row', alignItems: 'center', width: '100%' }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

interface DrawerMenuProps {
  currentRoute: string;
  onClose: () => void;
  variant?: 'store' | 'org' | 'super';
}

// Submenu tree dimensions — pixel-perfect match to sidebar.component.scss
// Web: tree line at calc(9px + 0.66rem) ≈ 20px from .submenu left
//      L-connector: width 0.6rem ≈ 10px, height 50% of item
//      Dot: positioned at left:-0.35rem (-6px) from button left, size 6px
//      Button padding-left: 0.5rem = 8px
// Mobile: submenuContainer.marginLeft = ICON_CENTER_X (36px) acts as the tree line X
//         Everything below is relative to the tree line (left: 0 in submenuContainer)
const ICON_CENTER_X = spacing[2] + spacing[4] + 12; // 36px
const SUBMENU_LINE_WIDTH = 2;
const SUBMENU_L_WIDTH = 10;   // 0.6rem ≈ 10px — horizontal reach of L-branch
const SUBMENU_L_HEIGHT = 14;  // height before the horizontal branch turns
const SUBMENU_DOT_SIZE = 6;   // matches web 6px dot
const SUBMENU_DOT_BORDER_WIDTH = 1.5;
const SUBMENU_TOP_GAP = 10;
const SUBMENU_TREE_COLOR = '#162b21'; // matches web --color-secondary (dark green/black)
// Dot center should be at end of L-connector (SUBMENU_L_WIDTH = 10px).
// Dot container is 16px wide → center at container_left + 8.
// We want center at 10 → container_left = 10 - 8 = 2.
const SUBMENU_DOT_LEFT = 2;   // absolute left of 16px dot container within submenuItemWrapper
// Pressable (button) starts after dot: dot right edge = 2 + 16 = 18px → marginLeft 20 for 2px gap
const SUBMENU_BUTTON_MARGIN_LEFT = 20; // matches web: button starts just after dot

export function DrawerMenu({ currentRoute, onClose, variant = 'store' }: DrawerMenuProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const user = useAuthStore((s) => s.user);
  const user_settings = useAuthStore((s) => s.user_settings);
  const store_settings = useAuthStore((s) => s.store_settings);
  const default_panel_ui = useAuthStore((s) => s.default_panel_ui);
  const logout = useAuthStore((s) => s.logout);
  
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [storeToSwitch, setStoreToSwitch] = useState<StoreListItem | null>(null);
  const [switching, setSwitching] = useState(false);

  const handleConfirmSwitch = async () => {
    if (!storeToSwitch) return;
    setSwitching(true);
    try {
      const { AuthService } = await import('@/core/auth/auth.service');
      await AuthService.switchEnvironment('STORE_ADMIN', storeToSwitch.slug);

      // Crítico: limpiar todo el cache de React Query para que las
      // queries se ejecuten con el nuevo token STORE_ADMIN
      const { getQueryClient } = await import('@/core/api/query-client');
      const qc = getQueryClient();
      await qc.cancelQueries();
      qc.clear();

      setStoreToSwitch(null);
      onClose();
      router.replace('/(store-admin)/dashboard' as never);
    } catch (error: any) {
      toastError(error?.message || 'No se pudo cambiar al entorno de la tienda. Intenta de nuevo.');
    } finally {
      setSwitching(false);
    }
  };

  const config = variantConfig[variant];
  const displayName = variant === 'org'
    ? 'Organizaciones'
    : user?.store?.name || user?.organizations?.name || 'Vendix';
  const displaySlug = variant === 'org'
    ? user?.organizations?.slug || ''
    : user?.store?.slug || user?.organizations?.slug || '';
  const orgLogoUrl = variant === 'org'
    ? user?.organizations?.logo_url || null
    : user?.store?.logo_url || user?.organizations?.logo_url || null;
  const vlinkUrl = displaySlug ? `/${displaySlug}` : '#';

  // Contextos y scopes de organización
  const activeOrg = variant === 'org' ? user?.organizations : user?.store?.organizations;
  const operatingScope = activeOrg?.operating_scope || 'STORE';
  const fiscalScope = activeOrg?.fiscal_scope || operatingScope;

  const orgSettings = activeOrg?.organization_settings?.settings || null;
  const fiscalStatus = fiscalScope === 'ORGANIZATION'
    ? orgSettings?.fiscal_status
    : store_settings?.fiscal_status;

  const activeFiscalAreas = useMemo(() => {
    const areas = ['invoicing', 'accounting', 'payroll'] as const;
    return areas.filter((area) => {
      const state = fiscalStatus?.[area]?.state;
      return state === 'ACTIVE' || state === 'LOCKED';
    });
  }, [fiscalStatus]);

  const panelUiConfig = user_settings?.config?.panel_ui || default_panel_ui || {};
  const appType = variant === 'org' ? 'ORG_ADMIN' : 'STORE_ADMIN';
  const currentAppPanelUi = useMemo<Record<string, boolean>>(() => {
    if (panelUiConfig && panelUiConfig[appType]) {
      return panelUiConfig[appType] as Record<string, boolean>;
    }
    return (panelUiConfig || {}) as unknown as Record<string, boolean>;
  }, [panelUiConfig, appType]);

  const disabledKeys = useMemo(() => {
    const disabled = new Set<string>();
    const areas = ['invoicing', 'accounting', 'payroll'] as const;
    const map = {
      accounting: [
        'accounting',
        'accounting_chart_of_accounts',
        'accounting_journal_entries',
        'accounting_fiscal_periods',
        'accounting_account_mappings',
        'accounting_flows_dashboard',
        'accounting_withholding_tax',
        'accounting_exogenous',
      ],
      payroll: [
        'payroll',
        'payroll_employees',
        'payroll_runs',
        'payroll_settlements',
        'payroll_advances',
        'payroll_settings',
      ],
      invoicing: [
        'invoicing',
        'invoicing_invoices',
        'invoicing_resolutions',
        'invoicing_dian_config',
      ],
    };
    for (const area of areas) {
      const state = fiscalStatus?.[area]?.state;
      if (state !== 'ACTIVE' && state !== 'LOCKED') {
        map[area].forEach((key) => disabled.add(key));
      }
    }
    return disabled;
  }, [fiscalStatus]);

  const storePanelUi = useMemo<Record<string, boolean>>(() => {
    if (appType === 'STORE_ADMIN' && store_settings?.panel_ui?.STORE_ADMIN) {
      return store_settings.panel_ui.STORE_ADMIN as Record<string, boolean>;
    }
    return {};
  }, [store_settings, appType]);

  const isModuleKeyVisible = (
    moduleKey: string | string[],
    panelUi: Record<string, boolean>,
    disabled: Set<string>
  ): boolean => {
    const keys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
    return keys.some((key) => {
      if (storePanelUi[key] === false) {
        return false;
      }
      return panelUi[key] === true && !disabled.has(key);
    });
  };

  // Cargar tiendas dinámicas solo para variant=org
  const { data: storesRaw, error: storesError } = useQuery({
    queryKey: ['org-stores-drawer'],
    queryFn: async () => {
      const { apiGet } = await import('@/core/api/http');
      const { Endpoints } = await import('@/core/api/endpoints');
      // Call raw to inspect exact shape and handle all envelope formats
      const raw: any = await apiGet(Endpoints.ORGANIZATION.STORES.LIST);
      return raw;
    },
    enabled: variant === 'org',
  });
  const stores: StoreListItem[] = useMemo(() => {
    if (!storesRaw) return [];
    // Handle: raw array
    if (Array.isArray(storesRaw)) return storesRaw;
    // Handle: { data: [...] } (paginated or envelope)
    if (storesRaw && typeof storesRaw === 'object' && Array.isArray(storesRaw.data)) return storesRaw.data;
    // Handle: { data: { data: [...] } } (nested paginated)
    if (storesRaw?.data && Array.isArray(storesRaw.data?.data)) return storesRaw.data.data;
    return [];
  }, [storesRaw]);


  // Construir items del menú org con tiendas dinámicas inyectadas
  const items: MenuItem[] = useMemo(() => {
    if (variant !== 'org') return config.items;
    return config.items.map((item) => {
      if (item.label === 'Tiendas' && item.children) {
        return {
          ...item,
          children: [
            ...item.children,
            ...stores.map((s) => ({
              label: s.name,
              icon: 'store',
              action: () => {
                setStoreToSwitch(s);
              },
            })),
          ],
        };
      }
      return item;
    });
  }, [variant, config.items, stores]);

  // Filtrado recursivo de items de menú
  const filteredItems = useMemo(() => {
    if (variant === 'super') return items;

    const filterRecursive = (menuItems: MenuItem[]): MenuItem[] => {
      return menuItems.reduce((acc: MenuItem[], item) => {
        // Fiscal scope guard
        if (item.requiredFiscalScope && item.requiredFiscalScope !== fiscalScope) {
          return acc;
        }

        // Fiscal area guard
        if (item.requiresFiscalArea) {
          if (item.requiresFiscalArea === 'any') {
            if (activeFiscalAreas.length === 0) return acc;
          } else {
            if (!activeFiscalAreas.includes(item.requiresFiscalArea as any)) return acc;
          }
        }

        // Operating scope guard
        let locked = false;
        if (item.requiredOperatingScope && item.requiredOperatingScope !== operatingScope) {
          if (item.showLocked) {
            locked = true;
          } else {
            return acc;
          }
        }

        // Check visibility
        let isVisible = false;
        if (item.alwaysVisible) {
          isVisible = true;
        } else {
          const moduleKey = moduleKeyMap[item.label];
          if (moduleKey) {
            isVisible = isModuleKeyVisible(moduleKey, currentAppPanelUi, disabledKeys);
          } else if (item.children && item.children.length > 0) {
            isVisible = true;
          } else {
            isVisible = true;
          }
        }

        if (isVisible) {
          const filteredItem = { ...item, _locked: locked };
          if (item.children && item.children.length > 0) {
            const children = filterRecursive(item.children);
            if (children.length > 0) {
              filteredItem.children = children;
              acc.push(filteredItem);
            }
          } else {
            acc.push(filteredItem);
          }
        }

        return acc;
      }, []);
    };

    return filterRecursive(items);
  }, [items, variant, fiscalScope, operatingScope, activeFiscalAreas, currentAppPanelUi, disabledKeys]);

  const handleOpenVlink = () => {
    if (vlinkUrl === '#') return;
    Linking.openURL(vlinkUrl).catch(() => {
      // Silently ignore — slug link is decorative when the URL is unreachable
    });
  };

  const handleNavigate = (href: string) => {
    onClose();
    router.push(href as never);
  };

  const handleLockedItemClick = (item: MenuItem) => {
    onClose();
    setTimeout(() => {
      Alert.alert(
        'Acceso restringido',
        item.lockedTooltip || 'Este módulo solo está disponible consolidado a nivel de organización.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Ir a Tiendas',
            onPress: () => {
              router.push('/(org-admin)/stores' as never);
            },
          },
        ]
      );
    }, 100);
  };

  const toggleSection = (label: string, _item: MenuItem) => {
    const wasExpanded = !!expandedSections[label];

    // Exclusive Accordion: close all others, toggle this one
    const nextExpanded: Record<string, boolean> = {};
    if (!wasExpanded) {
      nextExpanded[label] = true;
    }
    setExpandedSections(nextExpanded);
    // No auto-navigate: the user must explicitly click a sub-item to navigate.
  };

  const handleLogout = () => {
    onClose();
    logout();
    router.replace('/(auth)/login');
  };

  const normalizePath = (path: string) => {
    if (!path) return '';
    let clean = path.replace(/\/\([^)]+\)/g, '').replace(/\([^)]+\)\//g, '').replace(/\([^)]+\)/g, '');
    clean = clean.replace(/^\/+|\/+$/g, '');
    return clean;
  };

  const isRouteActive = (href?: string) => {
    if (!href) return false;
    const cleanHref = normalizePath(href);
    const cleanRoute = normalizePath(currentRoute);
    
    if (cleanHref === '') return cleanRoute === '';
    return cleanRoute === cleanHref || cleanRoute.startsWith(cleanHref + '/');
  };

  const hasActiveChild = (item: MenuItem) =>
    !!item.children?.some((c) => isRouteActive(c.href));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
          <Icon name="x" size={20} color={colorScales.gray[500]} />
        </Pressable>
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            {orgLogoUrl && orgLogoUrl !== 'vlogo.png' ? (
              <Image source={{ uri: orgLogoUrl }} style={styles.avatarImage} />
            ) : (
              <Image source={require('../../../assets/vlogo.png')} style={styles.avatarImage} />
            )}
          </View>
          <View style={styles.headerText}>
            <Text style={styles.displayName} numberOfLines={1}>
              {displayName}
            </Text>
            {displaySlug ? (
              <Pressable onPress={handleOpenVlink} hitSlop={4} style={styles.slugRow}>
                <Text style={styles.slug} numberOfLines={1}>
                  {displaySlug}
                </Text>
                <Icon name="link-2" size={12} color={colorScales.gray[500]} style={styles.slugLinkIcon} />
              </Pressable>
            ) : (
              <Text style={styles.slug}>
                {user?.email || config.label}
              </Text>
            )}
          </View>
        </View>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {filteredItems.map((item) => {
          const hasChildren = !!(item.children && item.children.length > 0);
          const isParentActive = !hasChildren && item.href ? isRouteActive(item.href) : false;
          const childIsActive = hasActiveChild(item);
          const isExpanded = expandedSections[item.label] ?? childIsActive;

          if (hasChildren) {
            return (
              <View key={item.label}>
                <SidebarButton
                  onPress={() => {
                    if (item._locked) {
                      handleLockedItemClick(item);
                    } else {
                      toggleSection(item.label, item);
                    }
                  }}
                  baseStyle={styles.menuItem}
                  pressedStyle={styles.menuItemPressed}
                  isLocked={item._locked}
                >
                  <View style={styles.menuIcon}>
                    <Icon
                      name={item._locked ? 'lock' : item.icon}
                      size={18}
                      color={colors.text.secondary}
                    />
                  </View>
                  <Text style={[
                    styles.menuLabel,
                    styles.menuLabelInactive,
                    item._locked && styles.lockedLabel,
                  ]}>
                    {item.label}
                  </Text>
                  {item._locked && (
                    <View style={styles.lockedBadge}>
                      <Text style={styles.lockedBadgeText}>
                        {item.lockedBadge || 'ORG'}
                      </Text>
                    </View>
                  )}
                  {!item._locked && (
                    <Icon
                      name={isExpanded ? 'chevron-down' : 'chevron-right'}
                      size={14}
                      color={colorScales.gray[400]}
                    />
                  )}
                </SidebarButton>

                <CollapsibleSubmenu isExpanded={isExpanded && !item._locked} childrenCount={item.children!.length}>
                  <View style={styles.submenuContainer}>
                    {item.children!.map((child, index) => {
                      const isActiveChild = isRouteActive(child.href);
                      const isLastChild = index === item.children!.length - 1;
                      return (
                        <View key={child.href ?? `${child.label}-${index}`} style={styles.submenuItemWrapper}>
                          {index === 0 && <View style={styles.submenuTopConnector} />}
                          <View style={styles.submenuLConnector} />
                          {!isLastChild && <View style={styles.submenuSegmentAfter} />}
                          
                          <View style={[styles.submenuIconContainer, { position: 'absolute', left: SUBMENU_DOT_LEFT, top: '50%', marginTop: -8, zIndex: 2 }]}>
                            {!child._locked && <View style={isActiveChild ? styles.submenuDotActive : styles.submenuDot} />}
                            {child._locked && (
                              <Icon
                                name="lock"
                                size={12}
                                color={colorScales.gray[400]}
                              />
                            )}
                          </View>

                          <SidebarButton
                            onPress={() => {
                              if (child._locked) {
                                handleLockedItemClick(child);
                              } else if (child.action) {
                                child.action();
                              } else if (child.href) {
                                handleNavigate(child.href);
                              }
                            }}
                            isActive={isActiveChild}
                            isLocked={child._locked}
                            baseStyle={styles.subMenuItem}
                            activeStyle={styles.subMenuItemActive}
                            pressedStyle={styles.subMenuItemPressed}
                          >
                            <Text
                              style={[
                                styles.subMenuLabel,
                                isActiveChild ? styles.subMenuLabelActive : styles.subMenuLabelInactive,
                                child._locked && styles.lockedSubmenuLabel,
                              ]}
                              numberOfLines={1}
                            >
                              {child.label}
                            </Text>
                            {child._locked && (
                              <View style={styles.lockedBadge}>
                                <Text style={styles.lockedBadgeText}>
                                  {child.lockedBadge || 'ORG'}
                                </Text>
                              </View>
                            )}
                          </SidebarButton>
                        </View>
                      );
                    })}
                  </View>
                </CollapsibleSubmenu>
              </View>
            );
          }

          return (
            <SidebarButton
              key={item.href}
              onPress={() => {
                if (item._locked) {
                  handleLockedItemClick(item);
                } else if (item.href) {
                  handleNavigate(item.href);
                }
              }}
              isActive={isParentActive}
              isLocked={item._locked}
              baseStyle={styles.menuItem}
              activeStyle={styles.menuItemActive}
              pressedStyle={styles.menuItemPressed}
            >
              <View style={styles.menuIcon}>
                <Icon
                  name={item._locked ? 'lock' : item.icon}
                  size={18}
                  color={isParentActive ? colors.card : colors.text.secondary}
                />
              </View>
              <Text style={[
                styles.menuLabel,
                isParentActive ? styles.menuLabelActive : styles.menuLabelInactive,
                item._locked && styles.lockedLabel,
              ]}>
                {item.label}
              </Text>
              {item._locked && (
                <View style={styles.lockedBadge}>
                  <Text style={styles.lockedBadgeText}>
                    {item.lockedBadge || 'ORG'}
                  </Text>
                </View>
              )}
            </SidebarButton>
          );
        })}
      </ScrollView>
      <ConfirmDialog
        visible={storeToSwitch !== null}
        onClose={() => setStoreToSwitch(null)}
        onConfirm={handleConfirmSwitch}
        title="Cambiar al entorno de la tienda"
        message={`¿Deseas cambiar al entorno de administración de la tienda "${storeToSwitch?.name}"?\n\nSerás redirigido al panel de administración de STORE_ADMIN para esta tienda específica.`}
        confirmLabel="Cambiar de entorno"
        cancelLabel="Cancelar"
        loading={switching}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.card,
  },
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    position: 'relative',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: borderRadius.md,
    resizeMode: 'contain',
  },
  headerText: {
    flex: 1,
    marginRight: spacing[8],
  },
  displayName: {
    fontSize: 15,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  slugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  slug: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  slugLinkIcon: {
    marginLeft: spacing[1],
  },
  scrollContent: {
    paddingVertical: spacing[2],
  },
  closeBtn: {
    position: 'absolute',
    top: spacing[3.5],
    right: spacing[3.5],
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    zIndex: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    marginHorizontal: spacing[2],
    borderRadius: borderRadius.lg,
  },
  menuItemActive: {
    backgroundColor: colors.primary,
  },
  menuItemPressed: {
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
  },
  menuIcon: {
    width: 24,
    height: 24,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2.5],
  },
  menuLabel: {
    fontSize: 13.5,
    fontWeight: typography.fontWeight.medium,
    flex: 1,
  },
  menuLabelActive: {
    color: colors.card,
  },
  menuLabelInactive: {
    color: colorScales.gray[700],
  },
  lockedItem: {
    opacity: 0.6,
  },
  lockedLabel: {
    color: colorScales.gray[400],
  },
  lockedSubmenuItem: {
    opacity: 0.6,
  },
  lockedSubmenuLabel: {
    color: colorScales.gray[400],
  },
  submenuContainer: {
    position: 'relative',
    marginLeft: ICON_CENTER_X,  // tree line starts here
    paddingRight: spacing[2],
    marginTop: -10,
    paddingTop: SUBMENU_TOP_GAP,
    paddingBottom: spacing[1],
  },
  submenuItemWrapper: {
    position: 'relative',
  },
  submenuLConnector: {
    position: 'absolute',
    left: 0,        // starts at tree line
    top: 0,
    width: SUBMENU_L_WIDTH + 2,  // L horizontal reach
    height: '50%',
    borderLeftWidth: SUBMENU_LINE_WIDTH,
    borderBottomWidth: SUBMENU_LINE_WIDTH,
    borderLeftColor: SUBMENU_TREE_COLOR,
    borderBottomColor: SUBMENU_TREE_COLOR,
    borderBottomLeftRadius: 6,
    backgroundColor: 'transparent',
  },
  submenuTopConnector: {
    position: 'absolute',
    left: 0,
    top: -SUBMENU_TOP_GAP,
    height: SUBMENU_TOP_GAP,
    width: SUBMENU_LINE_WIDTH,
    backgroundColor: SUBMENU_TREE_COLOR,
  },
  submenuSegmentAfter: {
    position: 'absolute',
    left: 0,
    top: '50%',
    bottom: 0,
    width: SUBMENU_LINE_WIDTH,
    backgroundColor: SUBMENU_TREE_COLOR,
  },
  // Button background — starts strictly AFTER the dot, matching web layout
  // Web: button left edge at ~35px from .submenu left, tree line at ~20px → 15px gap
  // Mobile: button at marginLeft:20 from tree line, paddingLeft:8 for text (matches web 0.5rem)
  subMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,     // web mobile: 0.6rem ≈ 10px, min-height: 40px touch target
    marginLeft: SUBMENU_BUTTON_MARGIN_LEFT,
    paddingLeft: 8,
    paddingRight: 10,
    marginRight: spacing[2],
    marginVertical: 1,
    borderRadius: borderRadius.lg,
  },
  subMenuItemActive: {
    backgroundColor: colors.primary,
  },
  subMenuItemPressed: {
    backgroundColor: 'rgba(46, 204, 113, 0.1)',
  },
  submenuIconContainer: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submenuDot: {
    width: SUBMENU_DOT_SIZE,
    height: SUBMENU_DOT_SIZE,
    borderRadius: SUBMENU_DOT_SIZE / 2,
    borderWidth: SUBMENU_DOT_BORDER_WIDTH,
    borderColor: SUBMENU_TREE_COLOR,
    backgroundColor: colors.card,
  },
  submenuDotActive: {
    width: SUBMENU_DOT_SIZE,
    height: SUBMENU_DOT_SIZE,
    borderRadius: SUBMENU_DOT_SIZE / 2,
    borderWidth: SUBMENU_DOT_BORDER_WIDTH,
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  subMenuLabel: {
    fontSize: 12,  // web: 0.75rem = 12px
    flex: 1,
  },
  subMenuLabelActive: {
    color: colors.card,
    fontWeight: typography.fontWeight.medium,
  },
  subMenuLabelInactive: {
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.normal,
  },
  lockedBadge: {
    borderWidth: 1,
    borderColor: colorScales.blue[500],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[1.5],
    paddingVertical: 1,
    marginLeft: 'auto',
    backgroundColor: colorScales.blue[50],
  },
  lockedBadgeText: {
    fontSize: 9,
    color: colorScales.blue[500],
    fontWeight: typography.fontWeight.bold,
  },
});
