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
} from '@/shared/theme';

export interface ScrollableTab {
  id: string;
  label: string;
  icon?: string;
}

interface ScrollableTabsProps {
  tabs: ScrollableTab[];
  activeTab: string;
  size?: 'sm' | 'md' | 'lg';
  onTabChange: (id: string) => void;
  /** Color de acento para la pestaña activa (default: `colors.primary`). */
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
}

const SIZE_CONFIG = {
  sm: { padX: 12, padY: 6, font: 'xs' as const, icon: 14, height: 32 },
  md: { padX: 14, padY: 8, font: 'sm' as const, icon: 16, height: 36 },
  lg: { padX: 16, padY: 10, font: 'base' as const, icon: 18, height: 44 },
} as const;

const FONT_SIZE: Record<'xs' | 'sm' | 'base', number> = {
  xs: typography.fontSize.xs,
  sm: typography.fontSize.sm,
  base: typography.fontSize.base,
};

/**
 * Espejo mobile del `app-scrollable-tabs` web.
 *
 * Horizontal scroll con tabs que activan onTabChange. La pestaña activa
 * se centra automáticamente al cambiar (UX idéntica a la web).
 *
 * Diferencia clave con `OrgOptionsDropdown`: este componente es **always
 * visible** y permite saltar entre secciones con scroll suave desde
 * el sticky header (paridad con el patrón web `scrollToSection`).
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

  // Centrar el tab activo (paridad con web `scrollIntoView`).
  useEffect(() => {
    const node = itemRefs.current[activeTab];
    if (!node || !scrollRef.current) return;
    // RN no expone measureInWindow en refs arbitrarias; usamos setTimeout
    // para esperar al siguiente frame y medir con measure.
    const handle = setTimeout(() => {
      node.measureInWindow((x, _y, width) => {
        scrollRef.current?.scrollTo({
          x: Math.max(0, x - 32),
          y: 0,
          animated: true,
        });
      });
    }, 50);
    return () => clearTimeout(handle);
  }, [activeTab]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.scroll, style]}
      style={styles.root}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Pressable
            key={tab.id}
            ref={(r) => {
              itemRefs.current[tab.id] = r;
            }}
            onPress={() => onTabChange(tab.id)}
            style={({ pressed }) => [
              styles.tab,
              {
                height: cfg.height,
                paddingHorizontal: cfg.padX,
                paddingVertical: cfg.padY,
                borderBottomColor: active ? accent : 'transparent',
                borderBottomWidth: active ? 2 : 0,
              },
              pressed && !active && styles.tabPressed,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            {tab.icon ? (
              <Icon
                name={tab.icon}
                size={cfg.icon}
                color={active ? accent : colorScales.gray[500]}
                style={{ marginRight: spacing[1.5] }}
              />
            ) : null}
            <Text
              style={[
                styles.label,
                {
                  fontSize: FONT_SIZE[cfg.font],
                  color: active ? colorScales.gray[900] : colorScales.gray[500],
                  fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.medium,
                },
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
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
    paddingHorizontal: spacing[4],
    gap: spacing[1],
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    borderRadius: 0,
  },
  tabPressed: {
    backgroundColor: colorScales.gray[50],
  },
  label: {
    textAlign: 'center',
  },
});
