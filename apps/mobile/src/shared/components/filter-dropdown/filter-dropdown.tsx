import { useState, useRef, useEffect } from 'react';
import { Pressable, Text, View, StyleSheet, ScrollView, type ViewStyle } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';

export interface FilterDropdownOption {
  label: string;
  value: string;
}

export interface FilterDropdownSection {
  label?: string;
  options: FilterDropdownOption[];
  onSelect: (value: string) => void;
}

interface FilterDropdownProps {
  /** Etiqueta opcional. Si no se pasa, se muestra solo el icono. */
  triggerLabel?: string;
  /** Icono del trigger (por defecto `sliders-horizontal`). */
  triggerIcon?: string;
  /** Secciones del dropdown. */
  sections: FilterDropdownSection[];
  /** Valor activo actualmente para resaltar la opción. */
  activeValue?: string;
  style?: ViewStyle;
}

/**
 * FilterDropdown — botón trigger con dropdown inline posicionado debajo.
 * Inspirado en el `app-options-dropdown` de la web.
 * - Trigger con icono (y label opcional) + badge con count de filtros activos.
 * - Dropdown se posiciona absolute debajo del trigger (NO usa BottomSheet).
 * - Estilo web: borde, shadow, esquinas redondeadas, colores primary.
 */
export function FilterDropdown({
  triggerLabel,
  triggerIcon = 'sliders-horizontal',
  sections,
  activeValue,
  style,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 0, right: 16 });
  const triggerRef = useRef<View>(null);

  // Contar filtros activos en todas las secciones
  const activeCount = sections.reduce(
    (sum, s) => sum + s.options.filter((o) => o.value === activeValue).length,
    0,
  );

  // Cerrar al tocar fuera del dropdown
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      // No-op; se cierra con onPress del backdrop
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      // Medir posición del trigger para posicionar el dropdown
      triggerRef.current.measureInWindow((x, y, width, height) => {
        setPosition({
          top: y + height + 6,
          right: 16, // Se posiciona a 16px del borde derecho
        });
        setOpen(true);
      });
    } else {
      setOpen(false);
    }
  };

  const handleSelect = (section: FilterDropdownSection, value: string) => {
    section.onSelect(value);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={handleToggle}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.triggerPressed,
          open && styles.triggerActive,
          style,
        ]}
      >
        <Icon name={triggerIcon} size={16} color={open ? colors.primary : colors.text.primary} />
        {triggerLabel ? <Text style={styles.triggerLabel}>{triggerLabel}</Text> : null}
        {activeCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{`${activeCount}`}</Text>
          </View>
        ) : null}
      </Pressable>

      {open && (
        <>
          {/* Backdrop transparente para cerrar al tocar fuera */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />
          {/* Dropdown */}
          <View
            style={[
              styles.dropdown,
              { top: position.top, right: position.right },
            ]}
          >
            <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {sections.map((section, sIdx) => (
                <View key={`section-${sIdx}`} style={styles.section}>
                  {section.label ? (
                    <Text style={styles.sectionLabel}>{section.label}</Text>
                  ) : null}
                  {section.options.map((opt) => {
                    const isActive = opt.value === activeValue;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => handleSelect(section, opt.value)}
                        style={({ pressed }) => [
                          styles.option,
                          isActive && styles.optionActive,
                          pressed && !isActive && styles.optionPressed,
                        ]}
                      >
                        <Text style={[styles.optionText, isActive && styles.optionTextActive]}>
                          {opt.label}
                        </Text>
                        {isActive ? (
                          <Icon name="check" size={14} color={colors.primary} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
    position: 'relative',
  },
  triggerPressed: {
    opacity: 0.7,
  },
  triggerActive: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  triggerLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colors.background,
  },
  dropdown: {
    position: 'absolute',
    minWidth: 220,
    maxWidth: 320,
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    ...shadows.lg,
    zIndex: 1000,
    elevation: 12,
  },
  scrollContent: {
    maxHeight: 320,
  },
  section: {
    paddingVertical: spacing[2],
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[1],
    paddingBottom: spacing[1],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  optionActive: {
    backgroundColor: colorScales.green[50],
  },
  optionPressed: {
    backgroundColor: colorScales.gray[50],
  },
  optionText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.normal as any,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
    flex: 1,
  },
  optionTextActive: {
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.primary,
  },
});
