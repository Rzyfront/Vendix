import { useRouter } from 'expo-router';
import { Pressable, Text, View, StyleSheet, ScrollView, ActivityIndicator, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export interface StickyHeaderAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'outline-danger' | 'ghost' | 'destructive';
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
            <Icon name="chevron-left" size={24} color={colors.text.primary} />
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
  const isOutlineDanger = action.variant === 'outline-danger';

  const bg = isPrimary
    ? colors.primary
    : isDestructive
      ? colorScales.red[600]
      : 'transparent';

  const borderColor = isOutlineDanger
    ? colorScales.red[300]
    : isOutline
      ? colorScales.gray[300]
      : isPrimary
        ? colors.primary
        : 'transparent';

  const borderWidth = isOutline || isOutlineDanger ? 1 : 0;
  const iconColor = isPrimary || isDestructive
    ? colors.background
    : isOutlineDanger
      ? colorScales.red[600]
      : colors.text.primary;

  return (
    <Pressable
      onPress={action.onPress}
      disabled={action.disabled || action.loading}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth,
        },
        isPrimary && styles.actionButtonPrimary,
        pressed && styles.actionPressed,
        (action.disabled || action.loading) && styles.disabled,
      ]}
    >
      {action.loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : action.icon ? (
        <Icon name={action.icon} size={18} color={iconColor} />
      ) : (
        <Text style={[styles.actionLabel, { color: iconColor }]} numberOfLines={1}>
          {action.label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
    ...shadows.sm,
  },
  wrapperGlass: {
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    gap: spacing[2],
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    // Parity con web responsive (`text-base md:text-lg font-bold text-gray-900`
    // en sticky-header.component.html). En viewport < md la web usa 16px,
    // coincidente con `typography.fontSize.base`. md+ la web sube a 18px
    // (`text-lg`); este componente por ahora sirve la variante mobile.
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  actionButtonPrimary: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  actionPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.95 }],
  },
  actionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
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