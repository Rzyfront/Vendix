import { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/core/store/auth.store';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, typography, spacing, borderRadius } from '@/shared/theme';
import { useQuery } from '@tanstack/react-query';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import type { StoreListItem } from '@/core/models/org-admin/store.types';

interface MenuItem {
  label: string;
  icon: string;
  href?: string;
  children?: { label: string; icon: string; href: string }[];
}

const baseOrgMenuItems: MenuItem[] = [
  { label: 'Panel Principal', icon: 'home', href: '/(org-admin)/dashboard' },
  {
    label: 'Tiendas',
    icon: 'store',
    href: '/(org-admin)/stores',
    children: [
      { label: 'Ver Todas las Tiendas', icon: 'list', href: '/(org-admin)/stores' },
    ],
  },
  { label: 'Usuarios', icon: 'users', href: '/(org-admin)/users' },
  {
    label: 'Inventario',
    icon: 'warehouse',
    children: [
      { label: 'Compras', icon: 'shopping-bag', href: '/(org-admin)/purchase-orders' },
      { label: 'Niveles de Stock', icon: 'package', href: '/(org-admin)/inventory/stock-levels' },
      { label: 'Ubicaciones', icon: 'map', href: '/(org-admin)/inventory/locations' },
      { label: 'Movimientos', icon: 'activity', href: '/(org-admin)/inventory/movements' },
      { label: 'Proveedores', icon: 'factory', href: '/(org-admin)/inventory/suppliers' },
      { label: 'Transferencias', icon: 'truck', href: '/(org-admin)/inventory/transfers' },
      { label: 'Ajustes de Stock', icon: 'sliders', href: '/(org-admin)/inventory/adjustments' },
      { label: 'Números de Serie', icon: 'barcode', href: '/(org-admin)/inventory/serial-numbers' },
      { label: 'Lotes', icon: 'layers', href: '/(org-admin)/inventory/batches' },
    ],
  },
  { label: 'Dominios', icon: 'globe', href: '/(org-admin)/domains' },
  { label: 'Roles', icon: 'shield', href: '/(org-admin)/roles' },
  {
    label: 'Auditoría y Cumplimiento',
    icon: 'eye',
    href: '/(org-admin)/audit/logs',
  },
  {
    label: 'Reportes',
    icon: 'bar-chart',
    children: [
      { label: 'Ventas', icon: 'trending-up', href: '/(org-admin)/reports/sales' },
      { label: 'Inventario', icon: 'package', href: '/(org-admin)/reports/inventory' },
      { label: 'Financiero', icon: 'dollar-sign', href: '/(org-admin)/reports/financial' },
    ],
  },
  {
    label: 'Operación fiscal',
    icon: 'clipboard-list',
    children: [
      { label: 'Dashboard fiscal', icon: 'layout-dashboard', href: '/(org-admin)/fiscal/dashboard' },
      { label: 'Obligaciones fiscales', icon: 'alert-triangle', href: '/(org-admin)/fiscal/obligations' },
      { label: 'Declaraciones fiscales', icon: 'file-text', href: '/(org-admin)/fiscal/declarations' },
      { label: 'Cierre fiscal', icon: 'lock', href: '/(org-admin)/fiscal/close' },
      { label: 'Evidencias fiscales', icon: 'archive', href: '/(org-admin)/fiscal/evidence' },
      { label: 'Historial fiscal', icon: 'history', href: '/(org-admin)/fiscal/history' },
      { label: 'Reglas fiscales', icon: 'shield', href: '/(org-admin)/fiscal/rules' },
    ],
  },
  {
    label: 'Contabilidad',
    icon: 'book-open',
    children: [
      { label: 'Plan de Cuentas', icon: 'list-tree', href: '/(org-admin)/accounting/chart-of-accounts' },
      { label: 'Asientos Contables', icon: 'scroll-text', href: '/(org-admin)/accounting/journal-entries' },
      { label: 'Periodos Fiscales', icon: 'calendar-clock', href: '/(org-admin)/accounting/fiscal-periods' },
      { label: 'Mapeo de Cuentas', icon: 'arrow-left-right', href: '/(org-admin)/accounting/account-mappings' },
    ],
  },
  {
    label: 'Facturación',
    icon: 'receipt',
    children: [
      { label: 'Facturas', icon: 'file-text', href: '/(org-admin)/invoicing/invoices' },
      { label: 'Resoluciones', icon: 'hash', href: '/(org-admin)/invoicing/resolutions' },
      { label: 'Configuración DIAN', icon: 'cog', href: '/(org-admin)/invoicing/dian-config' },
    ],
  },
  { label: 'Nómina', icon: 'banknote', href: '/(org-admin)/payroll' },
  {
    label: 'Configuración',
    icon: 'settings',
    children: [
      { label: 'General', icon: 'sliders', href: '/(org-admin)/settings/application' },
      { label: 'Modo operativo', icon: 'building', href: '/(org-admin)/settings/operating-scope' },
      { label: 'Modo fiscal', icon: 'receipt', href: '/(org-admin)/settings/fiscal-scope' },
      { label: 'Manejo fiscal', icon: 'scroll-text', href: '/(org-admin)/settings/fiscal-management' },
      { label: 'Métodos de Pago', icon: 'credit-card', href: '/(org-admin)/settings/payment-methods' },
    ],
  },
  { label: 'Órdenes', icon: 'clipboard-list', href: '/(org-admin)/orders' },
  { label: 'Suscripciones', icon: 'credit-card', href: '/(org-admin)/subscriptions' },
];

const storeMenuItems: MenuItem[] = [
  { label: 'Panel Principal', icon: 'home', href: '/(store-admin)/dashboard' },
  { label: 'Punto de venta', icon: 'shopping-cart', href: '/(store-admin)/pos' },
  { label: 'Órdenes', icon: 'clipboard-list', href: '/(store-admin)/orders' },
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
  { label: 'Gastos', icon: 'receipt', href: '/(store-admin)/expenses' },
  { label: 'Facturación', icon: 'file-text', href: '/(store-admin)/invoicing' },
  { label: 'Contabilidad', icon: 'calculator', href: '/(store-admin)/accounting' },
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

interface DrawerMenuProps {
  currentRoute: string;
  onClose: () => void;
  variant?: 'store' | 'org' | 'super';
}

// Submenu tree dimensions (alineado con la versión web: línea vertical + ramas L con esquina redondeada)
const ICON_CENTER_X = spacing[2] + spacing[4] + 16; // 40px — margin(8) + padding(16) + mitad iconContainer(32/2)
const SUBMENU_INDENT = 10; // px — ancho del L (~0.6rem = 9.6px ≈ 10px)
const SUBMENU_LINE_WIDTH = 2;
const SUBMENU_L_HEIGHT = 12; // altura donde está la rama horizontal (mitad del item ~24px) — centra el conector
const SUBMENU_DOT_SIZE = 6; // 6px — igual que la web
const SUBMENU_DOT_BORDER_WIDTH = 1.5;
const SUBMENU_TOP_GAP = 10; // px — espacio vertical entre el icono padre y el primer conector L

export function DrawerMenu({ currentRoute, onClose, variant = 'store' }: DrawerMenuProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const config = variantConfig[variant];
  const displayName = user?.store?.name || user?.organizations?.name || 'Vendix';
  const displaySlug = user?.store?.slug || user?.organizations?.slug || '';
  const vlinkUrl = displaySlug ? `/${displaySlug}` : '#';

  // Cargar tiendas dinámicas solo para variant=org
  const { data: storesResponse } = useQuery({
    queryKey: ['org-stores-drawer'],
    queryFn: () => OrgStoreService.list(),
    enabled: variant === 'org',
  });
  const stores: StoreListItem[] = useMemo(
    () => (Array.isArray(storesResponse?.data) ? storesResponse!.data : []),
    [storesResponse]
  );

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
              href: `/(org-admin)/stores/${s.id}/settings`,
            })),
          ],
        };
      }
      return item;
    });
  }, [variant, config.items, stores]);

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

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const handleLogout = () => {
    onClose();
    logout();
    router.replace('/(auth)/login');
  };

  const isRouteActive = (href: string) => currentRoute.includes(href);
  const hasActiveChild = (item: MenuItem) =>
    !!item.children?.some((c) => isRouteActive(c.href));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            <Icon name={config.icon} size={20} color="#fff" />
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
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <Icon name="x" size={20} color={colorScales.gray[500]} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {items.map((item) => {
          const hasChildren = !!(item.children && item.children.length > 0);
          // Los padres con hijos nunca se marcan activos — solo el hijo activo lo hace.
          const isParentActive = !hasChildren && item.href ? isRouteActive(item.href) : false;
          const childIsActive = hasActiveChild(item);
          const isExpanded = expandedSections[item.label] ?? childIsActive;

          if (hasChildren) {
            return (
              <View key={item.label}>
                <Pressable
                  onPress={() => toggleSection(item.label)}
                  style={[styles.menuItem, childIsActive && styles.menuItemActive]}
                >
                  <View style={styles.menuIcon}>
                    <Icon
                      name={item.icon}
                      size={18}
                      color={childIsActive ? colors.card : colors.text.secondary}
                    />
                  </View>
                  <Text style={[styles.menuLabel, childIsActive ? styles.menuLabelActive : styles.menuLabelInactive]}>
                    {item.label}
                  </Text>
                  <Icon
                    name={isExpanded ? 'chevron-down' : 'chevron-right'}
                    size={14}
                    color={childIsActive ? colors.card : colorScales.gray[400]}
                  />
                </Pressable>

                {isExpanded && (
                  <View style={styles.submenuContainer}>
                    {item.children!.map((child, index) => {
                      const isActiveChild = isRouteActive(child.href);
                      const isLastChild = index === item.children!.length - 1;
                      return (
                        <View key={child.href} style={styles.submenuItemWrapper}>
                          {/* Extensión vertical superior: conecta desde el icono padre hasta el primer conector L */}
                          {index === 0 && <View style={styles.submenuTopConnector} />}
                          {/* Conector en L: borderLeft (vertical) + borderBottom (horizontal) */}
                          <View style={styles.submenuLConnector} />
                          {/* Extensión vertical inferior: continúa la línea hasta el siguiente item */}
                          {!isLastChild && <View style={styles.submenuSegmentAfter} />}
                          <Pressable
                            onPress={() => handleNavigate(child.href)}
                            style={[styles.subMenuItem, isActiveChild && styles.subMenuItemActive]}
                          >
                            {/* Bullet del submenú: se oculta cuando el item está activo (la pastilla verde es el indicador) */}
                            {!isActiveChild && <View style={styles.submenuDot} />}
                            <Text
                              style={[
                                styles.subMenuLabel,
                                isActiveChild ? styles.subMenuLabelActive : styles.subMenuLabelInactive,
                              ]}
                              numberOfLines={1}
                            >
                              {child.label}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          }

          return (
            <Pressable
              key={item.href}
              onPress={() => item.href && handleNavigate(item.href)}
              style={[styles.menuItem, isParentActive && styles.menuItemActive]}
            >
              <View style={styles.menuIcon}>
                <Icon
                  name={item.icon}
                  size={18}
                  color={isParentActive ? colors.card : colors.text.secondary}
                />
              </View>
              <Text style={[styles.menuLabel, isParentActive ? styles.menuLabelActive : styles.menuLabelInactive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom || 12 }]}>
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && styles.logoutButtonPressed,
          ]}
        >
          <View style={styles.logoutIcon}>
            <Icon name="logout" size={18} color={colors.error} />
          </View>
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </Pressable>
      </View>
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
    paddingVertical: spacing[6],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  headerText: {
    flex: 1,
  },
  displayName: {
    fontSize: typography.fontSize.lg,
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
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    marginLeft: spacing[2],
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginHorizontal: spacing[2],
    borderRadius: borderRadius.lg,
  },
  // Item activo: pastilla verde sólida con texto blanco (alineado con la web)
  menuItemActive: {
    backgroundColor: colors.primary,
  },
  // Icono: contenedor transparente 32x32 para reservar hit-area y alinear con el row (sin caja gris, como la web)
  menuIcon: {
    width: 32,
    height: 32,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  menuLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    flex: 1,
  },
  // Label activo: blanco
  menuLabelActive: {
    color: colors.card,
  },
  menuLabelInactive: {
    color: colorScales.gray[700],
  },
  // Submenú: contenedor con indentación que aloja la línea vertical y las ramas L
  submenuContainer: {
    position: 'relative',
    marginLeft: ICON_CENTER_X, // 32px — alinea línea vertical con el centro del icono padre
    paddingLeft: SUBMENU_INDENT,
    paddingRight: spacing[2],
    // marginTop negativo: alinea el borde superior con la parte inferior del icono del menú padre
    // (icono 18px centrado con paddingVertical 12 → borde inferior a 30px → marginTop = -(42-30) = -12)
    marginTop: -12,
    // Espacio vertical entre el icono padre y el primer conector L
    paddingTop: SUBMENU_TOP_GAP,
    paddingBottom: spacing[1],
  },
  submenuItemWrapper: {
    position: 'relative',
  },
  // Conector en L: borderLeft (vertical) + borderBottom (horizontal)
  // Equivale a `.submenu-item::before` de la web
  submenuLConnector: {
    position: 'absolute',
    left: -SUBMENU_INDENT,
    top: 0,
    width: SUBMENU_INDENT,
    height: SUBMENU_L_HEIGHT,
    borderLeftWidth: SUBMENU_LINE_WIDTH,
    borderBottomWidth: SUBMENU_LINE_WIDTH,
    borderLeftColor: colors.primaryDark,
    borderBottomColor: colors.primaryDark,
    borderBottomLeftRadius: 6,
    backgroundColor: 'transparent',
  },
  // Extensión vertical desde el icono padre hasta el primer conector L
  submenuTopConnector: {
    position: 'absolute',
    left: -SUBMENU_INDENT,
    top: -SUBMENU_TOP_GAP,
    height: SUBMENU_TOP_GAP,
    width: SUBMENU_LINE_WIDTH,
    backgroundColor: colors.primaryDark,
  },
  // Extensión vertical desde la base del L hasta el fondo del item (se omite en el último)
  submenuSegmentAfter: {
    position: 'absolute',
    left: -SUBMENU_INDENT,
    top: SUBMENU_L_HEIGHT,
    bottom: 0,
    width: SUBMENU_LINE_WIDTH,
    backgroundColor: colors.primaryDark,
  },
  subMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[1.5],
    paddingLeft: 0,
    paddingRight: spacing[3],
    marginRight: spacing[1],
    marginVertical: 1,
    borderRadius: borderRadius.lg,
  },
  subMenuItemActive: {
    backgroundColor: colors.primary,
  },
  // Bullet del submenú: anillo (border, no fill) centrado en la rama horizontal del L — alineado con la web
  submenuDot: {
    width: SUBMENU_DOT_SIZE,
    height: SUBMENU_DOT_SIZE,
    borderRadius: SUBMENU_DOT_SIZE / 2,
    borderWidth: SUBMENU_DOT_BORDER_WIDTH,
    borderColor: colors.primaryDark,
    backgroundColor: 'transparent',
    marginRight: spacing[2],
  },
  subMenuLabel: {
    fontSize: typography.fontSize.xs,
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
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
  },
  logoutButtonPressed: {
    backgroundColor: colorScales.red[50],
  },
  logoutIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
    backgroundColor: colorScales.gray[50],
  },
  logoutText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.red[600],
  },
});
