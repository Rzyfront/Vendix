import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet, ScrollView, Modal, Dimensions, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

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
  /** Filter sections for the Filtros dropdown — mirrors web filters API */
  filters?: OptionsDropdownSection[];
  /** Actions for the Acciones dropdown — mirrors web actions API */
  actions?: OptionsDropdownAction[];
  /** Show the Acciones trigger (default true) */
  showActions?: boolean;
  /**
   * Compact mode mirrors web `max-width: 1023px` — both triggers collapse
   * to icon-only square buttons. Used by Categorías, Productos, Marcas.
   */
  compact?: boolean;
  style?: ViewStyle;
}

export function OptionsDropdown({
  filters = [],
  actions = [],
  showActions = true,
  compact = false,
  style,
}: OptionsDropdownProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, right: 0 });
  const actionsTriggerRef = React.useRef<View>(null);
  const filtersTriggerRef = React.useRef<View>(null);
  const screenW = Dimensions.get('window').width;

  const hasFilters = filters.length > 0;
  const hasActions = showActions && actions.length > 0;
  const activeFiltersCount = filters.reduce(
    (sum, s) => sum + s.options.filter((o) => o.active).length,
    0,
  );

  const measureTrigger = (
    ref: React.RefObject<View | null>,
    setOpenDropdown: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    ref.current?.measureInWindow((x, y, w, h) => {
      setDropPos({ top: y + h + 4, right: Math.max(0, screenW - (x + w)) });
      setOpenDropdown(true);
    });
  };

  const closeAll = () => {
    setActionsOpen(false);
    setFiltersOpen(false);
  };

  return (
    <>
      {/* ── Two separate trigger buttons (mirrors web .options-dropdown-container) ── */}
      <View style={[styles.triggerContainer, style]}>
        {/* Acciones trigger (left) */}
        {hasActions && (
          <Pressable
            ref={actionsTriggerRef}
            onPress={() => {
              if (filtersOpen) setFiltersOpen(false);
              measureTrigger(actionsTriggerRef, setActionsOpen);
            }}
            style={({ pressed }) => [
              styles.trigger,
              compact && styles.triggerCompact,
              pressed && styles.triggerPressed,
            ]}
          >
            <Icon
              name="sliders-horizontal"
              size={compact ? 18 : 16}
              color={compact ? colors.primary : colors.text.primary}
            />
            {!compact && <Text style={styles.triggerLabel}>Acciones</Text>}
            {!compact && (
              <Icon name="chevron-down" size={14} color={colors.text.muted} />
            )}
          </Pressable>
        )}

        {/* Filtros trigger (right) */}
        {hasFilters && (
          <Pressable
            ref={filtersTriggerRef}
            onPress={() => {
              if (actionsOpen) setActionsOpen(false);
              measureTrigger(filtersTriggerRef, setFiltersOpen);
            }}
            style={({ pressed }) => [
              styles.trigger,
              compact && styles.triggerCompact,
              pressed && styles.triggerPressed,
              hasActions && styles.triggerWithSibling,
            ]}
          >
            <Icon
              name="filter"
              size={compact ? 18 : 16}
              color={compact ? colors.primary : colors.text.primary}
            />
            {!compact && <Text style={styles.triggerLabel}>Filtros</Text>}
            {activeFiltersCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{activeFiltersCount}</Text>
              </View>
            )}
            {!compact && (
              <Icon name="chevron-down" size={14} color={colors.text.muted} />
            )}
          </Pressable>
        )}
      </View>

      {/* ── Acciones dropdown panel ── */}
      <Modal
        visible={actionsOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAll}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={closeAll}>
          <View style={[styles.dropdown, styles.actionsDropdown, { top: dropPos.top, right: dropPos.right }]}>
            <ScrollView
              style={styles.dropdownScroll}
              contentContainerStyle={styles.dropdownContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Acciones</Text>
                {actions.map((a, i) => (
                  <Pressable
                    key={`${a.label}-${i}`}
                    onPress={() => {
                      closeAll();
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
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* ── Filtros dropdown panel ── */}
      <Modal
        visible={filtersOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAll}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={closeAll}>
          <View style={[styles.dropdown, styles.filtersDropdown, { top: dropPos.top, right: dropPos.right }]}>
            {/* Header */}
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>Filtros</Text>
            </View>
            <ScrollView
              style={styles.dropdownScroll}
              contentContainerStyle={styles.dropdownContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.section}>
                {filters.map((section) => (
                  <FilterSelectField
                    key={section.label}
                    label={section.label}
                    options={section.options}
                    onSelect={section.onSelect}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * FilterSelectField — mirrors web `<app-selector size="sm">`.
 * Compact select dropdown with label, current value, chevron, and
 * a dropdown list of options.
 */
function FilterSelectField({
  label,
  options,
  onSelect,
}: {
  label: string;
  options: { label: string; value: string; active?: boolean }[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = options.find((o) => o.active);
  const display = active?.label || 'Seleccionar';
  const isPlaceholder = !active;

  return (
    <View style={styles.subsection}>
      <Text style={styles.subsectionLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.selectField,
          open && styles.selectFieldOpen,
          pressed && styles.selectFieldPressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text
          style={[styles.selectFieldText, isPlaceholder && styles.selectFieldPlaceholder]}
          numberOfLines={1}
        >
          {display}
        </Text>
        <Icon
          name="chevron-down"
          size={14}
          color={'#94A3B8'}
          style={[styles.selectFieldChevron, open && styles.selectFieldChevronOpen]}
        />
      </Pressable>
      {open && (
        <View style={styles.selectOptions}>
          {options.map((opt, idx) => (
            <Pressable
              key={`${label}-${opt.value}-${idx}`}
              onPress={() => {
                onSelect(opt.value);
                setOpen(false);
              }}
              style={({ pressed }) => [
                styles.selectOption,
                opt.active && styles.selectOptionActive,
                pressed && !opt.active && styles.selectOptionPressed,
              ]}
            >
              <Text
                style={[
                  styles.selectOptionText,
                  opt.active && styles.selectOptionTextActive,
                ]}
              >
                {opt.label}
              </Text>
              {opt.active && <Icon name="check" size={14} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  triggerContainer: {
    flexDirection: 'row',
    gap: spacing[2],
  },
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
  triggerWithSibling: {
    // Extra gap when both triggers are shown
  },
  triggerPressed: {
    backgroundColor: colorScales.gray[50],
  },
  // Compact mirrors web `max-width: 1023px` — icon-only square button
  triggerCompact: {
    width: 40,
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: colors.inputBg,
    borderColor: colors.primary,
    justifyContent: 'center',
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
  // ── Dropdown panel ──
  dropdown: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E6EDF3',
    width: 240,
    maxWidth: '90%',
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
    zIndex: 9999,
    overflow: 'hidden',
  },
  actionsDropdown: {
    // Actions dropdown aligns right from trigger
  },
  filtersDropdown: {
    // Filters dropdown also aligns right — mirrors web filters-dropdown
  },
  dropdownHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E6EDF3',
    backgroundColor: '#FFFFFF',
  },
  dropdownTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  dropdownScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  dropdownContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  section: {
    gap: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing[2],
  },
  subsection: {
    gap: spacing[2],
  },
  subsectionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: '#0F172A',
  },
  // ── Select field (mirrors web app-selector size="sm") ──
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 12,
    paddingRight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E6EDF3',
    backgroundColor: '#F4F4F4',
  },
  selectFieldOpen: {
    borderColor: '#2ECC71',
    backgroundColor: '#FFFFFF',
    shadowColor: '#7ED7A5',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  selectFieldPressed: {
    borderColor: '#2ECC71',
  },
  selectFieldText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: '#0F172A',
  },
  selectFieldPlaceholder: {
    color: '#94A3B8',
  },
  selectFieldChevron: {
    position: 'absolute',
    right: 12,
    transform: [{ rotate: '0deg' }, { translateY: -7 }],
  },
  selectFieldChevronOpen: {
    transform: [{ rotate: '180deg' }, { translateY: -7 }],
  },
  selectOptions: {
    marginTop: spacing[1],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E6EDF3',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  selectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6EDF3',
  },
  selectOptionActive: {
    backgroundColor: 'rgba(46, 204, 113, 0.08)',
  },
  selectOptionPressed: {
    backgroundColor: '#F1F5F9',
  },
  selectOptionText: {
    fontSize: typography.fontSize.sm,
    color: '#0F172A',
  },
  selectOptionTextActive: {
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
