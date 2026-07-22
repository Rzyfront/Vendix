import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { OrgBadge } from '@/shared/components/org-badge';
import {
  borderRadius,
  colorScales,
  colors,
  spacing,
  typography,
} from '@/shared/theme';

export interface OrgCardDetail {
  label: string;
  value: string;
  icon?: string;
  /** Si true, renderiza el value en monospace (para IPs, IDs, etc). */
  monospace?: boolean;
  /** Color del icono: 'primary' | 'warning' | 'danger' | 'success' | 'default'. */
  variant?: 'primary' | 'warning' | 'danger' | 'success' | 'default';
  /** Color directo (hex) para el ícono. Toma prioridad sobre `variant`. */
  iconColor?: string;
}

export interface OrgCardAction {
  key: string;
  label: string;
  icon: string;
  variant?: 'default' | 'primary' | 'warning' | 'danger';
  destructive?: boolean;
  onPress: () => void | Promise<void>;
  /** Si retorna false, oculta la acción (permisos). */
  visible?: boolean | (() => boolean);
  /** Si true, renderiza como botón outlined en el footer (max 2). */
  showInFooter?: boolean;
}

interface OrgResponsiveCardProps {
  title: string;
  subtitle?: string;
  /** Ícono a la izquierda del título (en el avatar wrapper). */
  leftIcon?: string;
  /** Color del ícono izquierdo (hex). Si no, usa `colors.primary`. */
  leftIconColor?: string;
  /** Etiqueta del badge (status / state). */
  badge?: { label: string; variant?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary' | 'muted' };
  /** Detalles a renderizar en la grid de 3 columnas. */
  details?: OrgCardDetail[];
  /** Valor destacado en el footer (precio, total, etc). */
  footerValue?: string;
  footerLabel?: string;
  /** Acciones: las primeras 2 con `showInFooter` salen como botones,
   *  el resto se agrupan en un dropdown more-horizontal. */
  actions?: OrgCardAction[];
  /** onPress sobre la card (abre modal de detalle, navega, etc). */
  onPress?: () => void;
  /** Mostrar chevron a la derecha (default true si hay onPress). */
  chevron?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VARIANT_COLOR = {
  primary: colors.primary,
  warning: colorScales.amber[600],
  danger: colors.error,
  success: colorScales.green[600],
  default: colorScales.gray[500],
} as const;

const ACTION_VARIANT_COLOR: Record<NonNullable<OrgCardAction['variant']>, string> = {
  default: colorScales.gray[700],
  primary: colors.primary,
  warning: colorScales.amber[600],
  danger: colors.error,
};

/**
 * Card responsive mobile, espejo del `ItemListComponent` de la web.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │ ┌───┐  Title                  [Badge]         │ ← card-title-row
 *   │ │ A │  Subtitle                                │
 *   │ └───┘                                          │
 *   │   [icon] Label        [icon] Label              │ ← card-details-grid (3 col)
 *   │   Value              Value                     │
 *   │ ──────────────────────────────────────────     │ ← card-footer
 *   │   Footer label / value   [Btns] [⋮]            │
 *   └────────────────────────────────────────────────┘
 *
 * - `details` se renderiza en grid de 3 columnas.
 * - Las primeras 2 acciones con `showInFooter` salen como botones.
 * - El resto (o si no caben) se agrupan en un dropdown `more-horizontal`.
 */
export function OrgResponsiveCard({
  title,
  subtitle,
  leftIcon,
  leftIconColor,
  badge,
  details,
  footerValue,
  footerLabel,
  actions,
  onPress,
  chevron,
  style,
}: OrgResponsiveCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const showChevron = chevron ?? !!onPress;

  const visibleActions = (actions ?? []).filter((a) => {
    if (typeof a.visible === 'function') return a.visible();
    if (a.visible === undefined) return true;
    return a.visible;
  });

  const footerButtons = visibleActions.filter((a) => a.showInFooter).slice(0, 2);
  const menuActions = visibleActions.filter(
    (a) => !footerButtons.find((b) => b.key === a.key),
  );

  const hasFooter =
    !!footerValue || !!footerLabel || footerButtons.length > 0 || menuActions.length > 0;
  const hasDetails = !!details && details.length > 0;

  const handleMenuAction = async (action: OrgCardAction) => {
    setMenuOpen(false);
    setTimeout(() => action.onPress(), 120);
  };

  return (
    <Card style={StyleSheet.flatten([styles.card, style])} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.body}>
        {/* Avatar wrapper */}
        {leftIcon ? (
          <View
            style={[
              styles.avatar,
              { backgroundColor: (leftIconColor ?? colors.primary) + '15' },
            ]}
          >
            <Icon
              name={leftIcon}
              size={20}
              color={leftIconColor ?? colors.primary}
            />
          </View>
        ) : null}

        {/* Main content */}
        <View style={styles.mainContent}>
          {/* Title row */}
          <View style={styles.titleRow}>
            <View style={styles.titleGroup}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.badgeWrap}>
              {badge ? <OrgBadge {...badge} /> : null}
              {showChevron && onPress ? (
                <Icon
                  name="chevron-right"
                  size={16}
                  color={colorScales.gray[400]}
                />
              ) : null}
            </View>
          </View>

          {/* Details grid (3-col on wide, 2-col on narrow via flex) */}
          {hasDetails ? (
            <View style={styles.detailsGrid}>
              {details!.map((d, i) => {
                const color =
                  d.iconColor ?? VARIANT_COLOR[d.variant ?? 'default'];
                return (
                  <View key={`${d.label}-${i}`} style={styles.detailItem}>
                    <Text style={styles.detailLabel} numberOfLines={1}>
                      {d.label}
                    </Text>
                    <View style={styles.detailValueWrap}>
                      {d.icon ? (
                        <Icon
                          name={d.icon}
                          size={12}
                          color={color}
                          style={styles.detailLabelIcon}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.detailValue,
                          d.monospace && styles.detailValueMono,
                        ]}
                        numberOfLines={1}
                      >
                        {d.value}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>

      {/* Footer */}
      {hasFooter ? (
        <View style={styles.footer}>
          <View style={styles.footerContent}>
            {footerLabel ? (
              <Text style={styles.footerLabel} numberOfLines={1}>
                {footerLabel}
              </Text>
            ) : null}
            {footerValue ? (
              <Text style={styles.footerValue} numberOfLines={1}>
                {footerValue}
              </Text>
            ) : !footerLabel ? (
              <View />
            ) : null}
          </View>

          {(footerButtons.length > 0 || menuActions.length > 0) ? (
            <View style={styles.footerActions}>
              {footerButtons.map((a) => {
                const variant = a.variant ?? 'default';
                const color = ACTION_VARIANT_COLOR[variant];
                const isDestructive = a.destructive ?? variant === 'danger';
                return (
                  <Pressable
                    key={a.key}
                    style={[
                      styles.footerBtn,
                      isDestructive && styles.footerBtnDestructive,
                    ]}
                    onPress={(e) => {
                      e.stopPropagation();
                      a.onPress();
                    }}
                    hitSlop={6}
                    accessibilityLabel={a.label}
                  >
                    <Icon name={a.icon} size={16} color={color} />
                  </Pressable>
                );
              })}
              {menuActions.length > 0 ? (
                <>
                  <Pressable
                    style={styles.footerBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      setMenuOpen(true);
                    }}
                    hitSlop={6}
                    accessibilityLabel="Más acciones"
                  >
                    <Icon
                      name="more-horizontal"
                      size={18}
                      color={colorScales.gray[500]}
                    />
                  </Pressable>
                  <Modal
                    visible={menuOpen}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setMenuOpen(false)}
                  >
                    <Pressable
                      style={styles.backdrop}
                      onPress={() => setMenuOpen(false)}
                    >
                      <Pressable
                        style={styles.menuSheet}
                        onPress={(e) => e.stopPropagation()}
                      >
                        <View style={styles.handle} />
                        {menuActions.map((a, idx) => {
                          const variant = a.variant ?? 'default';
                          const color = ACTION_VARIANT_COLOR[variant];
                          const isDestructive =
                            a.destructive ?? variant === 'danger';
                          return (
                            <Pressable
                              key={a.key}
                              style={[
                                styles.menuItem,
                                idx > 0 && styles.menuItemBorder,
                                isDestructive && styles.menuItemDestructive,
                              ]}
                              onPress={() => handleMenuAction(a)}
                            >
                              <View
                                style={[
                                  styles.menuIcon,
                                  { backgroundColor: color + '15' },
                                ]}
                              >
                                <Icon name={a.icon} size={16} color={color} />
                              </View>
                              <Text
                                style={[styles.menuLabel, { color }]}
                                numberOfLines={1}
                              >
                                {a.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                        <Pressable
                          style={styles.cancelBtn}
                          onPress={() => setMenuOpen(false)}
                        >
                          <Text style={styles.cancelText}>Cancelar</Text>
                        </Pressable>
                      </Pressable>
                    </Pressable>
                  </Modal>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing[2],
    padding: spacing[3],
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  mainContent: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexShrink: 0,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing[3],
    rowGap: spacing[3],
  },
  detailItem: {
    width: '33.333%',
    paddingRight: spacing[2],
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  detailLabelIcon: {
    marginRight: 2,
  },
  detailValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[900],
    flexShrink: 1,
  },
  detailValueMono: {
    fontFamily: 'monospace',
    fontSize: typography.fontSize.xs,
  },
  footer: {
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  footerContent: {
    flex: 1,
    minWidth: 0,
  },
  footerLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  footerValue: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginTop: 2,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  footerBtn: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  footerBtnDestructive: {
    backgroundColor: colors.error + '12',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingBottom: spacing[6],
    paddingTop: spacing[2],
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colorScales.gray[300],
    alignSelf: 'center',
    marginBottom: spacing[2],
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    marginHorizontal: spacing[2],
    borderRadius: borderRadius.lg,
  },
  menuItemBorder: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    borderRadius: 0,
  },
  menuItemDestructive: {},
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  cancelBtn: {
    marginTop: spacing[2],
    marginHorizontal: spacing[2],
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    backgroundColor: colorScales.gray[100],
  },
  cancelText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
});
