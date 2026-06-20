import { useEffect, useRef } from 'react';
import {
  ScrollView,
  Pressable,
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import {
  colors,
  colorScales,
  spacing,
  typography,
  borderRadius,
} from '@/shared/theme';

export interface ScrollableTab {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}

interface ScrollableTabsProps {
  tabs: ScrollableTab[];
  activeTab: string;
  /** Default 'md' (≈ web mobile 11px/30px). 'lg' = web desktop 12px/32px. */
  size?: 'sm' | 'md' | 'lg';
  onTabChange: (id: string) => void;
  /** Color de acento para la pestaña activa (default: `colors.primary`). */
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
}

const SIZE_CONFIG = {
  sm: { padX: 10, padY: 5, fontPx: 11, icon: 12, height: 30, gap: 4 },
  md: { padX: 10, padY: 5, fontPx: 11, icon: 13, height: 30, gap: 4 },
  lg: { padX: 12, padY: 6, fontPx: 12, icon: 13, height: 32, gap: 6 },
} as const;

/**
 * Espejo mobile del `app-scrollable-tabs` web (`sticky-header.component.scss`).
 *
 * Replica exactamente:
 *   • font-size 11px (mobile breakpoint web).
 *   • font-weight 700 con opacity 0.78 inactivo → 1 activo.
 *   • `::after` pill de 2px al fondo del tab activo (transform scaleX animado).
 *   • border-radius top-rounded (radius-md 0 0) — base plana.
 *   • scroll-snap-align center en el tab activo.
 *   • gap 4px entre tabs.
 *   • color-mix inactivo = `--color-text-secondary` (gray-500), activo = `--color-primary` + label gris-900.
 */
export function ScrollableTabs({
  tabs,
  activeTab,
  size = 'md',
  onTabChange,
  accentColor,
  style,
}: ScrollableTabsProps) {
  const scrollRef = useRef<ScrollView>(null);
  const itemRefs = useRef<Record<string, View | null>>({});
  const cfg = SIZE_CONFIG[size];
  const accent = accentColor ?? colors.primary;

  // Centrar el tab activo (paridad con web `scroll-snap-align: center`).
  useEffect(() => {
    const node = itemRefs.current[activeTab];
    if (!node || !scrollRef.current) return;
    const handle = setTimeout(() => {
      node.measureInWindow((x) => {
        scrollRef.current?.scrollTo({ x: Math.max(0, x - 32), y: 0, animated: true });
      });
    }, 50);
    return () => clearTimeout(handle);
  }, [activeTab]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.scroll, { gap: cfg.gap }, style]}
      style={styles.root}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTab && !tab.disabled;
        return (
          <Pressable
            key={tab.id}
            ref={(r) => {
              itemRefs.current[tab.id] = r;
            }}
            onPress={() => !tab.disabled && onTabChange(tab.id)}
            disabled={tab.disabled}
            style={({ pressed }) => [
              styles.tab,
              {
                minHeight: cfg.height,
                paddingHorizontal: cfg.padX,
                paddingVertical: cfg.padY,
              },
              pressed && !active && !tab.disabled && styles.tabPressed,
              tab.disabled && styles.tabDisabled,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !!tab.disabled }}
          >
            {tab.icon ? (
              <Icon
                name={tab.icon}
                size={cfg.icon}
                color={active ? accent : colorScales.gray[500]}
              />
            ) : null}
            <Text
              style={[
                styles.label,
                {
                  fontSize: cfg.fontPx,
                  color: active ? colorScales.gray[900] : colorScales.gray[500],
                  fontWeight: typography.fontWeight.bold,
                  opacity: active ? 1 : 0.78,
                },
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
            {/* Pill indicator (web ::after) */}
            {active ? (
              <View style={[styles.tabIndicator, { backgroundColor: accent }]} />
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'visible',
  },
  scroll: {
    paddingHorizontal: spacing[1.5], // web: 0.375rem = 6px (mobile)
    alignItems: 'flex-end',
  },
  tab: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: borderRadius.md,
    borderTopRightRadius: borderRadius.md,
  },
  tabPressed: {
    backgroundColor: colorScales.green[50],
  },
  tabDisabled: {
    opacity: 0.55,
  },
  label: {
    textAlign: 'center',
    lineHeight: 14,
  },
  tabIndicator: {
    position: 'absolute',
    left: spacing[2.5],
    right: spacing[2.5],
    bottom: -1,
    height: 2,
    borderRadius: 999,
  },
});
