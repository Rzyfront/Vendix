import { useMemo, useState } from 'react';
import { Pressable, Text, View, StyleSheet, TextInput, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export interface MultiSelectorOption<T = string | number> {
  label: string;
  value: T;
  imageUrl?: string | null;
  icon?: string;
  /**
   * Etiqueta secundaria que se muestra a la derecha del `label`, alineada
   * al final y truncada al 40% del ancho. Útil para mostrar el nombre de
   * la categoría junto al nombre de la opción (mirrors el patrón web).
   */
  subLabel?: string;
}

interface MultiSelectorProps<T = string | number> {
  values: T[];
  onChange: (values: T[]) => void;
  options: MultiSelectorOption<T>[];
  max?: number;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  /**
   * Muestra una barra de búsqueda en el popover cuando está abierto.
   * Útil cuando la lista de opciones es larga. El filtrado es
   * case-insensitive por `label`.
   */
  searchable?: boolean;
  /** Texto placeholder del input de búsqueda. */
  searchPlaceholder?: string;
  /** Texto cuando no hay opciones disponibles. */
  emptyText?: string;
  style?: ViewStyle;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('es-CO')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function MultiSelector<T = string | number>({
  values,
  onChange,
  options,
  max,
  placeholder = 'Seleccionar…',
  label,
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Buscar…',
  emptyText = 'No hay opciones disponibles',
  style,
}: MultiSelectorProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedOptions = options.filter((o) => values.includes(o.value));

  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const trimmed = query.trim();
    if (!trimmed) return options;
    const needle = normalize(trimmed);
    return options.filter((opt) => normalize(opt.label).includes(needle));
  }, [options, query, searchable]);

  function toggle(value: T) {
    const set = new Set(values);
    if (set.has(value)) {
      set.delete(value);
    } else {
      if (max && set.size >= max) return;
      set.add(value);
    }
    onChange(Array.from(set));
  }

  function clear() {
    onChange([]);
  }

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={style}>
      {label && (
        <Text style={styles.label}>
          {label}
        </Text>
      )}

      <Pressable
        onPress={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.triggerPressed,
          disabled && styles.disabled,
        ]}
      >
        {selectedOptions.length === 0 ? (
          <Text style={[styles.triggerText, styles.placeholder]} numberOfLines={1}>
            {placeholder}
          </Text>
        ) : (
          <View style={styles.chipsRow}>
            {selectedOptions.map((opt) => (
              <View key={String(opt.value)} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {opt.label}
                </Text>
                <Pressable
                  onPress={() => toggle(opt.value)}
                  hitSlop={8}
                  style={styles.chipRemove}
                >
                  <Icon name="x" size={12} color={colorScales.gray[700]} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.text.secondary}
        />
      </Pressable>

      {/*
        Popover renderizado INLINE (sin <Modal>) para evitar el bug conocido
        de RN donde el <TextInput> dentro de un Modal transparente pierde
        el foco en cuanto aparece el teclado. Al renderizar el popover
        como un View normal en el árbol, el teclado funciona nativo.
      */}
      {open && (
        <View style={styles.popover}>
          <View style={styles.popoverHeader}>
            <Text style={styles.modalHint}>
              {values.length === 0
                ? 'Toca para agregar'
                : `${values.length} seleccionado${values.length === 1 ? '' : 's'}`}
              {max ? ` (máx. ${max})` : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing[2] }}>
              {values.length > 0 && (
                <Pressable onPress={clear} hitSlop={8}>
                  <Text style={styles.clearText}>Limpiar</Text>
                </Pressable>
              )}
              <Pressable onPress={close} hitSlop={8}>
                <Text style={styles.clearText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>

          {searchable && (
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
            />
          )}

          {filteredOptions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {searchable && query.trim()
                  ? `Sin resultados para "${query.trim()}"`
                  : emptyText}
              </Text>
            </View>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = values.includes(opt.value);
              const isDisabled = !!max && !isSelected && values.length >= max;
              return (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => !isDisabled && toggle(opt.value)}
                  disabled={isDisabled}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                    isSelected && styles.optionSelected,
                    isDisabled && styles.disabled,
                  ]}
                >
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Icon name="check" size={12} color="#FFFFFF" />}
                  </View>
                  <Text style={styles.optionLabel} numberOfLines={1}>
                    {opt.label}
                  </Text>
                  {opt.subLabel !== undefined && opt.subLabel !== '' && (
                    <Text style={styles.optionSubLabel} numberOfLines={1}>
                      {opt.subLabel}
                    </Text>
                  )}
                </Pressable>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Input de búsqueda con borde primary en focus.
 */
function SearchInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.searchBox, focused && styles.searchBoxFocused]}>
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text.muted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        // Importante: NO usar autoFocus aquí porque al renderizar el
        // popover inline, autoFocus puede provocar focus theft con
        // otros inputs. El usuario debe tocar el input para enfocarlo.
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: colors.text.secondary,
    marginBottom: spacing[1],
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colorScales.gray[50],
    gap: spacing[2],
  },
  triggerPressed: {
    backgroundColor: colorScales.gray[100],
  },
  triggerText: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.text.primary,
  },
  placeholder: {
    color: colors.text.muted,
  },
  disabled: {
    opacity: 0.5,
  },
  chipsRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.green[50] ?? '#F0FDF4',
    borderRadius: borderRadius.full,
    paddingLeft: spacing[3],
    paddingRight: spacing[1],
    paddingVertical: spacing[1],
    gap: spacing[1],
    maxWidth: 200,
  },
  chipText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.green[700] ?? '#15803D',
    flexShrink: 1,
  },
  chipRemove: {
    padding: 2,
  },
  // Popover (renderizado inline, sin Modal). Mismo visual que la web:
  // card con border-radius, sombra, header con hint + acciones.
  popover: {
    marginTop: spacing[1.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  popoverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorScales.gray[100],
  },
  modalHint: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    flexShrink: 1,
  },
  clearText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: '500',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorScales.gray[100],
  },
  optionPressed: {
    backgroundColor: colorScales.gray[50],
  },
  optionSelected: {
    backgroundColor: colorScales.green[50] ?? '#F0FDF4',
  },
  optionLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  optionSubLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    maxWidth: '40%',
    flexShrink: 0,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: borderRadius.sm,
    borderWidth: 1.5,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  // Búsqueda
  searchBox: {
    marginHorizontal: spacing[3],
    marginTop: spacing[3],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  searchBoxFocused: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  searchInput: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    paddingVertical: 0,
  },
  emptyState: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[6],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
  },
});

export type { MultiSelectorProps };
