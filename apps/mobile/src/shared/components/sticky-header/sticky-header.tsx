import { useRouter } from 'expo-router';
import { Pressable, Text, View, StyleSheet, ScrollView, ActivityIndicator, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export interface StickyHeaderAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost' | 'destructive';
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  iconRight?: boolean;
}

export interface StickyHeaderTab {
  label: string;
  value: string;
  badge?: string | number;
  active?: boolean;
  onPress: () => void;
}

interface StickyHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  onBack?: () => void;
  actions?: StickyHeaderAction[];
  tabs?: StickyHeaderTab[];
  variant?: 'default' | 'glass';
  style?: ViewStyle;
  /** Show close (X) button alongside back arrow. Default false. */
  showCloseButton?: boolean;
}

export function StickyHeader({
  title,
  subtitle,
  backHref,
  onBack,
  actions = [],
  tabs,
  variant = 'default',
  style,
  showCloseButton = false,
}: StickyHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  function handleBack() {
    if (onBack) onBack();
    else if (backHref) router.push(backHref as any);
    else router.back();
  }

  const isGlass = variant === 'glass';

  return (
    <View
      style={[
        styles.wrapper,
        { paddingTop: spacing[2] },
        isGlass && styles.wrapperGlass,
        style,
      ]}
    >
      <View style={styles.row}>
        {(backHref || onBack) && (
          <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
            <Icon name="arrow-left" size={18} color={colors.text.secondary} />
          </Pressable>
        )}
        {showCloseButton && (
          <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
            <Icon name="x" size={22} color={colors.text.primary} />
          </Pressable>
        )}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle && (
            // Mirror web `sticky-header-subtitle hidden sm:block` — sólo visible en pantallas anchas.
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {actions.length > 0 && (
          <View style={styles.actions}>
            {actions.map((a, i) => (
              <ActionButton key={`${a.label}-${i}`} action={a} />
            ))}
          </View>
        )}
      </View>
      {tabs && tabs.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
        >
          {tabs.map((tab) => (
            <Pressable
              key={tab.value}
              onPress={tab.onPress}
              style={({ pressed }) => [
                styles.tab,
                tab.active && styles.tabActive,
                pressed && !tab.active && styles.tabPressed,
              ]}
            >
              <Text style={[styles.tabLabel, tab.active && styles.tabLabelActive]}>
                {tab.label}
              </Text>
              {tab.badge !== undefined && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{tab.badge}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ActionButton({ action }: { action: StickyHeaderAction }) {
  const isPrimary = action.variant === 'primary';
  const isDestructive = action.variant === 'destructive';
  const isOutline = action.variant === 'outline';

  const bg = isPrimary
    ? colors.primary
    : isDestructive
      ? colorScales.red[600]
      : 'transparent';
  const borderColor = isOutline ? 'rgba(126, 215, 165, 0.5)' : 'transparent';
  const textColor = isPrimary || isDestructive
    ? colors.background
    : colors.primary;

  return (
    <Pressable
      onPress={action.onPress}
      disabled={action.disabled || action.loading}
      style={({ pressed }) => [
        styles.actionButton,
        isPrimary && styles.actionPrimary,
        isOutline && styles.actionOutline,
        pressed && styles.actionPressed,
        (action.disabled || action.loading) && styles.disabled,
      ]}
    >
      {action.loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          {/* Icon (siempre visible) */}
          {action.icon && !action.iconRight && (
            <Icon name={action.icon} size={16} color={textColor} />
          )}
          {/* Label (oculto en mobile para ahorrar espacio — `md:flex-row` lo muestra en pantallas grandes).
              Para forzar visibilidad en mobile, agregar `style={{ ...styles.actionLabelOverride, display: 'flex' }}` externamente. */}
          {action.label ? (
            <Text style={[styles.actionLabel, { color: textColor }]} numberOfLines={1}>
              {action.label}
            </Text>
          ) : null}
          {action.icon && action.iconRight && (
            <Icon name={action.icon} size={16} color={textColor} />
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
    ...shadows.sm,
  },
  wrapperGlass: {
    // Mirror web `bg-[rgba(255,255,255,0.95)]` — fondo semitransparente.
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  // Botón back cuadrado (mirror web `!w-7 !h-7 md:!w-8 md:!h-8 !rounded-lg`).
  backButton: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: '700' as any,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  // Action button: 36x36 icon-only en mobile. `actionPrimary` y `actionOutline`
  // aplican los estilos exactos del web (`btn-shadow-primary` y `btn-outline-border`).
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: spacing[2],
    borderRadius: 10,
  },
  actionPrimary: {
    backgroundColor: colors.primary,
    shadowColor: '#7ED7A5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 3,
  },
  actionOutline: {
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.5)',
  },
  actionPressed: {
    opacity: 0.85,
  },
  // En mobile el label se oculta para mantener el botón icon-only.
  actionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700' as any,
    marginLeft: spacing[2],
    display: 'none',
  },
  disabled: {
    opacity: 0.5,
  },
  tabsRow: {
    gap: spacing[1],
    marginTop: spacing[3],
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[100],
    gap: spacing[1],
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabPressed: {
    backgroundColor: colorScales.gray[200],
  },
  tabLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: colors.background,
  },
  tabBadge: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[1],
    minWidth: 18,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
});

export type { StickyHeaderProps };