import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, typography, borderRadius, interFonts } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface PosHeaderProps {
  onOpenDrawer: () => void;
  onOpenSearch?: () => void;
  onOpenNotifications: () => void;
  onOpenUserMenu: () => void;
  notificationCount?: number;
  userInitials: string;
  title?: string;
  /**
   * @deprecated Usa `parentLabel` + `parentIcon` en su lugar.
   * Se conserva como fallback para layouts que aún pasan breadcrumb como string.
   */
  breadcrumb?: string;
  /**
   * Etiqueta del segmento padre en el breadcrumb (categoría/sección).
   * Paridad con web `HeaderComponent` (breadcrumb.service):
   *   [parentIcon] parent.label  /  [currentIcon blue] currentLabel
   *
   * Ejemplo: "Panel Administrativo" en ORG_ADMIN, "Tienda" en STORE_ADMIN,
   * "Super admin" en SUPER_ADMIN.
   */
  parentLabel?: string;
  /**
   * Ícono opcional para el segmento padre del breadcrumb (gray-600 en mobile).
   * Si no se provee, no se renderiza ícono — sólo texto + separator.
   */
  parentIcon?: string;
  /**
   * Etiqueta del segmento current del breadcrumb (al lado del ícono current).
   * INDEPENDIENTE del title — el breadcrumb puede decir "panel principal"
   * mientras el h1 dice "Dashboard".
   *
   * Si no se provee, se usa `title` como fallback (retro-compat).
   */
  currentLabel?: string;
  /**
   * Ícono del segmento current del breadcrumb (default: 'home').
   * Siempre azul (colors.primary) para paridad con web text-blue-600.
   */
  currentIcon?: string;
  /**
   * Slot opcional para acciones extra que se renderizan en la zona derecha
   * del header, ANTES del botón de búsqueda. Se usa para inyectar el
   * scope chip (org/store) en ORG_ADMIN — paridad con el web HeaderComponent.
   */
  extraActions?: React.ReactNode;
}

export function PosHeader({
  onOpenDrawer,
  onOpenSearch,
  onOpenNotifications,
  onOpenUserMenu,
  notificationCount = 0,
  userInitials,
  title = 'Punto de venta',
  breadcrumb,
  parentLabel,
  parentIcon,
  currentLabel,
  currentIcon = 'home',
  extraActions,
}: PosHeaderProps) {
  const insets = useSafeAreaInsets();

  // Resolución de breadcrumb (3 niveles de prioridad):
  //   1) parentLabel + parentIcon + currentLabel (nuevo contrato — preferido)
  //   2) breadcrumb string con formato "Parent / Current" (legacy store-admin)
  //   3) breadcrumb string simple (legacy sin estructura)
  const resolved = resolveBreadcrumb(parentLabel, parentIcon, currentLabel ?? title, breadcrumb);

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}>
      {/* Left: Logo + Chevron + (Breadcrumb / Title) */}
      <View style={styles.headerLeft}>
        <Pressable onPress={onOpenDrawer} hitSlop={8} style={styles.logoBox}>
          <Image
            source={require('@/assets/logo.png')}
            style={styles.logoImage}
            resizeMode="cover"
          />
        </Pressable>
        <Icon name="chevron-right" size={16} color={colorScales.gray[300]} style={styles.separator} />
        <View style={styles.titleContainer}>
          {resolved ? (
            <View style={styles.breadcrumbRow}>
              {resolved.parentIcon ? (
                <Icon
                  name={resolved.parentIcon}
                  size={14}
                  color={colorScales.gray[600]}
                  style={styles.breadcrumbIcon}
                />
              ) : null}
              {resolved.parent ? (
                <Text style={styles.breadcrumbParent} numberOfLines={1}>
                  {resolved.parent}
                </Text>
              ) : null}
              {resolved.parent && resolved.current ? (
                <Text style={styles.breadcrumbSep} numberOfLines={1}>
                  /
                </Text>
              ) : null}
              <Icon
                name={currentIcon}
                size={14}
                color={colors.primary}
                style={styles.breadcrumbIcon}
              />
              {resolved.current ? (
                <Text style={styles.breadcrumbCurrent} numberOfLines={1}>
                  {resolved.current}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      {/* Right: Extra actions (e.g. scope chip) + Search + Notifications + User */}
      <View style={styles.headerRight}>
        {extraActions}
        <Pressable
          onPress={onOpenSearch || (() => {})}
          hitSlop={8}
          style={styles.iconButton}
        >
          <Icon name="search" size={18} color={colorScales.gray[500]} />
        </Pressable>

        <Pressable onPress={onOpenNotifications} hitSlop={8} style={styles.iconButton}>
          <View style={styles.iconWrapper}>
            <Icon name="bell" size={18} color={colorScales.gray[500]} />
            {notificationCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Text>
              </View>
            )}
          </View>
        </Pressable>

        <Pressable onPress={onOpenUserMenu} hitSlop={8} style={styles.userAvatar}>
          <Text style={styles.userInitials}>{userInitials}</Text>
          <View style={styles.userStatusDot} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Resuelve el breadcrumb en la estructura { parent, parentIcon, current }.
 * Soporta:
 *   - parentLabel + currentLabel explícitos (contrato nuevo) — siempre wins
 *   - string legacy con formato "Parent / Current" — se parsea
 *   - string legacy simple — se trata como current sin parent
 *
 * Si parentLabel/parentIcon están presentes pero currentLabel no, se usa
 * `fallbackCurrent` (típicamente `title`) como texto current.
 */
function resolveBreadcrumb(
  parentLabel: string | undefined,
  parentIcon: string | undefined,
  fallbackCurrent: string,
  breadcrumb: string | undefined,
): { parent?: string; parentIcon?: string; current?: string } | null {
  if (parentLabel || parentIcon) {
    return { parent: parentLabel, parentIcon, current: fallbackCurrent };
  }
  if (breadcrumb) {
    const parts = breadcrumb.split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return { current: parts[0] };
    return { parent: parts[0], current: parts.slice(1).join(' / ') };
  }
  return null;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    flex: 1,
    minWidth: 0,
  },
  logoBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  logoImage: {
    width: 36,
    height: 36,
  },
  separator: {
    marginHorizontal: 2,
  },
  titleContainer: {
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  // ── Breadcrumb (espejo del web HeaderComponent) ────────────────────────
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  breadcrumbIcon: {
    marginTop: -1, // visual baseline alignment con texto
  },
  breadcrumbParent: {
    fontSize: 12,
    fontFamily: interFonts.medium,
    color: colorScales.gray[600],
    maxWidth: 140,
  },
  breadcrumbSep: {
    fontSize: 12,
    color: colorScales.gray[400],
    marginHorizontal: 2,
  },
  breadcrumbCurrent: {
    fontSize: 12,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
  },
  title: {
    // Paridad con web HeaderComponent: <h1 class="text-sm sm:text-xl ...">.
    // En mobile (≤sm) el h1 es text-sm = 14px, NO xl (20px). El bold +
    // tracking-tight mantienen la jerarquía visual pese al tamaño menor.
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    letterSpacing: -0.2,
    lineHeight: 20,
    marginTop: 0,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 14,
    height: 14,
    backgroundColor: colors.error,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  notificationBadgeText: {
    fontSize: 8,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
  // Avatar de usuario más pequeño y verde menta (como la web)
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  userInitials: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.green[800],
  },
  userStatusDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#F97316',
    borderWidth: 1.5,
    borderColor: colors.background,
  },
});