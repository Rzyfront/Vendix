import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/core/store/auth.store';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, typography, spacing, borderRadius } from '@/shared/theme';

interface MenuItem {
  label: string;
  icon: string;
  href: string;
  children?: { label: string; icon: string; href: string }[];
}

const storeMenuItems: MenuItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/(store-admin)/dashboard' },
  { label: 'Punto de venta', icon: 'shopping-cart', href: '/(store-admin)/pos' },
  { label: 'Productos', icon: 'package', href: '/(store-admin)/products' },
  { label: 'Órdenes', icon: 'clipboard-list', href: '/(store-admin)/orders' },
  {
    label: 'Inventario', icon: 'warehouse', href: '/(store-admin)/inventory/pop',
    children: [
      { label: 'Punto de Compra', icon: 'shopping-cart', href: '/(store-admin)/inventory/pop' },
      { label: 'Ajustes', icon: 'sliders', href: '/(store-admin)/inventory/adjustments' },
      { label: 'Transferencias', icon: 'truck', href: '/(store-admin)/inventory/transfers' },
      { label: 'Movimientos', icon: 'activity', href: '/(store-admin)/inventory/movements' },
      { label: 'Proveedores', icon: 'store', href: '/(store-admin)/inventory/suppliers' },
      { label: 'Ubicaciones', icon: 'warehouse', href: '/(store-admin)/inventory/locations' },
    ],
  },
  { label: 'Clientes', icon: 'users', href: '/(store-admin)/customers' },
  { label: 'Facturación', icon: 'file-text', href: '/(store-admin)/invoicing' },
  { label: 'Contabilidad', icon: 'calculator', href: '/(store-admin)/accounting' },
  { label: 'Gastos', icon: 'receipt', href: '/(store-admin)/expenses' },
  { label: 'Analíticas', icon: 'bar-chart', href: '/(store-admin)/analytics' },
  { label: 'Configuración', icon: 'settings', href: '/(store-admin)/settings' },
];

const orgMenuItems: MenuItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/(org-admin)/dashboard' },
  { label: 'Tiendas', icon: 'store', href: '/(org-admin)/stores' },
  { label: 'Usuarios', icon: 'users', href: '/(org-admin)/users' },
  { label: 'Roles', icon: 'shield', href: '/(org-admin)/roles' },
  { label: 'Órdenes', icon: 'clipboard-list', href: '/(org-admin)/orders' },
  { label: 'Suscripciones', icon: 'credit-card', href: '/(org-admin)/subscriptions' },
  { label: 'Configuración', icon: 'settings', href: '/(org-admin)/settings' },
];

const superMenuItems: MenuItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/(super-admin)/dashboard' },
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
  org: { items: orgMenuItems, icon: 'building-2' as const, label: 'Organización' },
  super: { items: superMenuItems, icon: 'shield' as const, label: 'Vendix Admin' },
};

interface DrawerMenuProps {
  currentRoute: string;
  onClose: () => void;
  variant?: 'store' | 'org' | 'super';
}

// Submenu tree dimensions (alineado con la versión web: línea vertical + ramas L)
const SUBMENU_INDENT = spacing[8]; // 32 — espacio para línea vertical + L-branch
const SUBMENU_LINE_WIDTH = 2;
const SUBMENU_DOT_SIZE = 8;
const SUBMENU_DOT_BORDER = 1.5;
const SUBMENU_DOT_GLOW_SIZE = SUBMENU_DOT_SIZE + 8;
const ACTIVE_GLOW_RGBA = 'rgba(34, 197, 94, 0.25)';

export function DrawerMenu({ currentRoute, onClose, variant = 'store' }: DrawerMenuProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const config = variantConfig[variant];
  const displayName = user?.store?.name || user?.organizations?.name || 'Vendix';

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
            <Text style={styles.email}>
              {user?.email || config.label}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <Icon name="x" size={20} color={colorScales.gray[500]} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {config.items.map((item) => {
          const hasChildren = !!(item.children && item.children.length > 0);
          // Los padres con hijos nunca se marcan activos — solo el hijo activo lo hace.
          const isParentActive = !hasChildren && isRouteActive(item.href);
          const childIsActive = hasActiveChild(item);
          const isExpanded = expandedSections[item.label] ?? childIsActive;

          if (hasChildren) {
            return (
              <View key={item.label}>
                <Pressable
                  onPress={() => toggleSection(item.label)}
                  style={[styles.menuItem, childIsActive && styles.menuItemActive]}
                >
                  <View style={[styles.menuIcon, childIsActive ? styles.menuIconActive : styles.menuIconInactive]}>
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
                          {/* Rama en L desde la línea vertical hasta el item (mitad superior) */}
                          <View style={styles.submenuLBranch} />
                          {/* Continuación vertical (mitad inferior) — se omite en el último hijo */}
                          {!isLastChild && <View style={styles.submenuSegmentAfter} />}
                          <Pressable
                            onPress={() => handleNavigate(child.href)}
                            style={[styles.subMenuItem, isActiveChild && styles.subMenuItemActive]}
                          >
                            <View
                              style={[
                                styles.submenuDot,
                                isActiveChild && styles.submenuDotActive,
                              ]}
                            >
                              {isActiveChild && <View style={styles.submenuDotGlow} />}
                            </View>
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
              onPress={() => handleNavigate(item.href)}
              style={[styles.menuItem, isParentActive && styles.menuItemActive]}
            >
              <View style={[styles.menuIcon, isParentActive ? styles.menuIconActive : styles.menuIconInactive]}>
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
  email: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
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
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  // Icono activo: sin fondo propio (la pastilla del item provee el color)
  menuIconActive: {
    backgroundColor: 'transparent',
  },
  menuIconInactive: {
    backgroundColor: colorScales.gray[50],
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
    marginLeft: spacing[4],
    paddingLeft: SUBMENU_INDENT,
    paddingRight: spacing[2],
    paddingBottom: spacing[1],
  },
  submenuItemWrapper: {
    position: 'relative',
  },
  // Rama en L: borde izquierdo vertical + borde inferior horizontal (mitad superior del item)
  submenuLBranch: {
    position: 'absolute',
    left: -SUBMENU_INDENT,
    top: 0,
    width: SUBMENU_INDENT,
    height: '50%',
    borderLeftWidth: SUBMENU_LINE_WIDTH,
    borderBottomWidth: SUBMENU_LINE_WIDTH,
    borderColor: colors.primaryDark,
    borderBottomLeftRadius: borderRadius.md,
  },
  // Continuación vertical: línea verde oscuro desde la mitad hasta el fondo del item
  submenuSegmentAfter: {
    position: 'absolute',
    left: -SUBMENU_INDENT,
    top: '50%',
    bottom: 0,
    width: SUBMENU_LINE_WIDTH,
    backgroundColor: colors.primaryDark,
  },
  subMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingLeft: 0,
    paddingRight: spacing[3],
    marginRight: spacing[1],
    marginVertical: 1,
    borderRadius: borderRadius.lg,
  },
  subMenuItemActive: {
    backgroundColor: colors.primary,
  },
  // Bullet del submenú: anillo hueco (alineado con la web)
  submenuDot: {
    width: SUBMENU_DOT_SIZE,
    height: SUBMENU_DOT_SIZE,
    borderRadius: SUBMENU_DOT_SIZE / 2,
    borderWidth: SUBMENU_DOT_BORDER,
    borderColor: colors.primaryDark,
    backgroundColor: colors.background,
    marginRight: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bullet activo: relleno verde + glow ring
  submenuDotActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  submenuDotGlow: {
    position: 'absolute',
    width: SUBMENU_DOT_GLOW_SIZE,
    height: SUBMENU_DOT_GLOW_SIZE,
    borderRadius: SUBMENU_DOT_GLOW_SIZE / 2,
    backgroundColor: ACTIVE_GLOW_RGBA,
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
