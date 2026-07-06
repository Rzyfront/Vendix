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
  filterSections?: OptionsDropdownSection[];
  actions?: OptionsDropdownAction[];
  triggerLabel?: string;
  triggerIcon?: string;
  /**
   * Espejo web `max-width: 1023px` — el trigger colapsa a un botón
   * cuadrado (sólo icono, sin label ni chevron). Usado por Categorías,
   * Productos, Marcas y otras listas en mobile.
   */
  compact?: boolean;
  style?: ViewStyle;
}

export function OptionsDropdown({
  filterSections = [],
  actions = [],
  triggerLabel = 'Filtros y acciones',
  triggerIcon = 'sliders-horizontal',
  compact = false,
  style,
}: OptionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, right: 0 });
  const triggerRef = React.useRef<View>(null);
  const screenW = Dimensions.get('window').width;

  const hasFilters = filterSections.length > 0;
  const hasActions = actions.length > 0;
  const activeCount = filterSections.reduce(
    (sum, s) => sum + s.options.filter((o) => o.active).length,
    0,
  );

  const openDropdown = () => {
    triggerRef.current?.measureInWindow((x, y, w, h) => {
      // Espejo web `.options-dropdown-content` — absolute, top 100% + gap,
      // right-aligned (filters-dropdown). En mobile (compact): el ancho
      // del dropdown se ancla al botón trigger y aparece debajo.
      setDropPos({
        top: y + h + 4,
        right: Math.max(0, screenW - (x + w)),
      });
      setOpen(true);
    });
  };

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={openDropdown}
        style={({ pressed }) => [
          styles.trigger,
          compact && styles.triggerCompact,
          pressed && styles.triggerPressed,
          style,
        ]}
      >
        <Icon
          name={triggerIcon}
          size={compact ? 18 : 16}
          color={compact ? colors.primary : colors.text.primary}
        />
        {!compact && (
          <Text style={styles.triggerLabel}>{triggerLabel}</Text>
        )}
        {!compact && activeCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{activeCount}</Text>
          </View>
        )}
      </Pressable>

      {/* Dropdown anclado al trigger (espejo web .options-dropdown-content) */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* Overlay transparente cierra el dropdown al tap fuera */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setOpen(false)}
        >
          <View style={[styles.dropdown, { top: dropPos.top, right: dropPos.right }]}>
            {/* Header — espejo .dropdown-header web (border-bottom + título) */}
            {hasFilters && (
              <View style={styles.dropdownHeader}>
                <Text style={styles.dropdownTitle}>Filtros</Text>
              </View>
            )}

            {/* Body scrolleable — espejo .filters-body web */}
            <ScrollView
              style={styles.dropdownScroll}
              contentContainerStyle={styles.dropdownContent}
              showsVerticalScrollIndicator={false}
            >
              {hasFilters && (
                <View style={styles.section}>
                  {filterSections.map((section) => (
                    <FilterSelectField
                      key={section.label}
                      label={section.label}
                      options={section.options}
                      onSelect={(value) => {
                        section.onSelect(value);
                        // No cerramos el dropdown principal — el usuario
                        // puede querer ajustar varios filtros antes de
                        // cerrar manualmente. Coincide con la UX web
                        // donde el popover queda abierto hasta tap fuera.
                      }}
                    />
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
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * FilterSelectField — espejo del `<app-selector size="sm">` web.
 *
 * Renderiza un campo select desplegable (no chips):
 *   · Cabecera: Pressable con label de la sección + valor actual +
 *     chevron-down a la derecha (h-8 rounded-xl border-border w-full).
 *     Mismo styling que la web CSS de `.inputsearch-wrapper`/select:
 *     bg #f4f4f4, border 1px #e6edf3, pl-3 pr-10, radius 0.75rem.
 *   · Cuerpo desplegable: lista vertical de opciones con la activa
 *     marcada (check + color primario). `bg #ffffff`, padding 16.
 *   · Mismo patrón que `<select>` HTML del web — pero sin opciones
 *     nativas (`<option>`) — sólo items-tap-internos.
 *
 * Props:
 *   label    — título de la sección ("Estado", "Destacado", etc.)
 *   options  — items disponibles con `value` y `label`, marca active
 *   onSelect — callback al elegir una opción
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

      {/* Cabecera del select — estilo web:
          bg #f4f4f4, pl-3 pr-10, rounded-xl (.75rem), h-8 (mobile)
          hover border-primary, focus border-primary + ring */}
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

      {/* Lista desplegable — espejo del `<select>` HTML expandido */}
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
  // Espejo web `.options-dropdown-trigger` cuando max-width: 1023px.
  // El trigger se vuelve un cuadrado 2.5rem con borde verde primario —
  // sólo contiene el icono. Border 1px #2ecc71, color #2ecc71, radius
  // .75rem. Aplica a Categorías, Productos, Marcas, etc. en mobile.
  triggerCompact: {
    width: 40,
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: colors.inputBg, // #ffffff (bg-surface)
    borderColor: colors.primary,    // #2ecc71
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
  // ── Dropdown anclado al trigger (espejo web .options-dropdown-content)
  // Web:
  //   position: absolute; top: 100%; margin-top: 0.5rem;
  //   width: 20rem; max-width: 90vw; max-height: 80vh;
  //   background-color: #ffffff;
  //   border: 1px solid #e6edf3;
  //   border-radius: .5rem;
  //   box-shadow: rgba(0,0,0,.1) 0 10px 15px -3px,
  //              rgba(0,0,0,.05) 0 4px 6px -2px;
  //   z-index: 99999;
  dropdown: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E6EDF3',
    width: 240,                       // ≈ 20rem
    maxWidth: '90%' as any,           // RN no acepta 'vw' directo
    maxHeight: '70%' as any,          // RN no acepta 'vh' directo
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
    zIndex: 9999,
    overflow: 'hidden',
  },
  // Header web: padding .75rem 1rem, border-bottom 1px #e6edf3, bg #ffffff
  dropdownHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E6EDF3',
    backgroundColor: '#FFFFFF',
  },
  // .dropdown-title web: .875rem / 600 / #0f172a
  dropdownTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  // .filters-body web: padding .75rem 1rem, gap .75rem, max-height 40vh
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
  sectionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colorScales.gray[200],
    paddingTop: spacing[3],
  },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing[2],
  },
  // ── Espejo .filter-section + .filter-label web (filter-section column
  // gap .5rem, label .875rem/500/#0f172a)
  subsection: {
    gap: spacing[2],
  },
  subsectionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: '#0F172A',
  },

  // ── Espejo <app-selector size="sm"> web (select desplegable) ──
  // CSS base: bg #f4f4f4, border 1px #e6edf3, h-8 (mobile) / h-9 (md+),
  // pl-3 pr-10, rounded-xl (.75rem), color #0f172a, fs .875rem.
  // hover border-primary, focus border-primary + shadow ring.
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,                   // h-8 mobile (sm:h-9 = 36 sería md+)
    paddingHorizontal: 12,       // pl-3
    paddingRight: 40,           // pr-10 (espacio para chevron-right)
    borderRadius: 12,            // .75rem
    borderWidth: 1,
    borderColor: '#E6EDF3',      // border-border web
    backgroundColor: '#F4F4F4',  // bg #f4f4f4 (!bg-background web)
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
    borderColor: '#2ECC71',     // hover state
  },
  selectFieldText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: '#0F172A',
  },
  selectFieldPlaceholder: {
    color: '#94A3B8',            // text-text-muted web (Seleccionar)
  },
  // Chevron-down absoluto web: right-3 top-1/2
  selectFieldChevron: {
    position: 'absolute',
    right: 12,
    transform: [{ rotate: '0deg' }, { translateY: -7 }], // -translate-y-1/2 (mitad del icono 14px)
  },
  selectFieldChevronOpen: {
    transform: [{ rotate: '180deg' }, { translateY: -7 }],
  },
  // Lista desplegable — items con padding 12/10, hover bg, active verde
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