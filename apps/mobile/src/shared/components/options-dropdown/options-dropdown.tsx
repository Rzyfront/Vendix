import { useState } from 'react';
import { Pressable, Text, View, StyleSheet, ScrollView, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';

export interface OptionsDropdownFilter {
  label: string;
  value: string;
  active?: boolean;
}

export interface OptionsDropdownSection {
  label: string;
  options: OptionsDropdownFilter[];
  onSelect: (value: string) => void;
}

export interface OptionsDropdownAction {
  label: string;
  icon?: string;
  variant?: 'default' | 'destructive';
  onPress: () => void;
}

interface OptionsDropdownProps {
  filterSections?: OptionsDropdownSection[];
  actions?: OptionsDropdownAction[];
  triggerLabel?: string;
  triggerIcon?: string;
  style?: ViewStyle;
}

export function OptionsDropdown({
  filterSections = [],
  actions = [],
  triggerLabel = 'Filtros y acciones',
  triggerIcon = 'sliders-horizontal',
  style,
}: OptionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const hasFilters = filterSections.length > 0;
  const hasActions = actions.length > 0;
  const activeCount = filterSections.reduce(
    (sum, s) => sum + s.options.filter((o) => o.active).length,
    0,
  );

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.triggerPressed,
          style,
        ]}
      >
        <Icon name={triggerIcon} size={16} color={colors.text.primary} />
        <Text style={styles.triggerLabel}>{triggerLabel}</Text>
        {activeCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{activeCount}</Text>
          </View>
        )}
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        snapPoint="partial"
      >
        <View style={styles.handle} />
        <ScrollView style={styles.scroll}>
          {hasFilters && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Filtros</Text>
              {filterSections.map((section) => (
                <View key={section.label} style={styles.subsection}>
                  <Text style={styles.subsectionLabel}>{section.label}</Text>
                  <View style={styles.optionsGrid}>
                    {section.options.map((opt) => (
                      <Pressable
                        key={`${section.label}-${opt.value}`}
                        onPress={() => section.onSelect(opt.value)}
                        style={({ pressed }) => [
                          styles.option,
                          opt.active && styles.optionActive,
                          pressed && !opt.active && styles.optionPressed,
                        ]}
                      >
                        <Text
                          style={[styles.optionLabel, opt.active && styles.optionLabelActive]}
                          numberOfLines={1}
                        >
                          {opt.label}
                        </Text>
                        {opt.active && <Icon name="check" size={14} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          {hasActions && (
            <View style={[styles.section, hasFilters && styles.sectionDivider]}>
              <Text style={styles.sectionTitle}>Acciones</Text>
              {actions.map((a, i) => (
                <Pressable
                  key={`${a.label}-${i}`}
                  onPress={() => {
                    setOpen(false);
                    a.onPress();
                  }}
                  style={({ pressed }) => [
                    styles.action,
                    a.variant === 'destructive' && styles.actionDestructive,
                    pressed && styles.actionPressed,
                  ]}
                >
                  {a.icon && (
                    <Icon
                      name={a.icon}
                      size={18}
                      color={a.variant === 'destructive' ? colors.error : colors.text.primary}
                    />
                  )}
                  <Text
                    style={[
                      styles.actionLabel,
                      a.variant === 'destructive' && styles.actionLabelDestructive,
                    ]}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.inputBg,
    gap: spacing[2],
  },
  triggerPressed: {
    backgroundColor: colorScales.gray[50],
  },
  triggerLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: colors.text.primary,
  },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    minWidth: 20,
    paddingHorizontal: spacing[1],
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.background,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colorScales.gray[300],
    alignSelf: 'center',
    marginVertical: spacing[2],
  },
  scroll: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[6],
  },
  section: {
    marginBottom: spacing[4],
  },
  sectionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colorScales.gray[200],
    paddingTop: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing[3],
  },
  subsection: {
    marginBottom: spacing[3],
  },
  subsectionLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginBottom: spacing[2],
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.inputBg,
    gap: spacing[1],
  },
  optionActive: {
    backgroundColor: colors.primaryLight ?? '#F0FDF4',
    borderColor: colors.primary,
  },
  optionPressed: {
    backgroundColor: colorScales.gray[100],
  },
  optionLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  optionLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  actionPressed: {
    opacity: 0.6,
  },
  actionDestructive: {},
  actionLabel: {
    fontSize: typography.fontSize.base,
    color: colors.text.primary,
  },
  actionLabelDestructive: {
    color: colors.error,
  },
});

export type { OptionsDropdownProps };