import { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  View,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  type ViewStyle,
} from 'react-native';
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
   * Muestra una barra de búsqueda en el modal. Útil cuando la lista de
   * opciones es larga (ej. lista de impuestos configurados). El filtrado
   * es case-insensitive por `label`.
   */
  searchable?: boolean;
  /** Texto placeholder del input de búsqueda. */
  searchPlaceholder?: string;
  style?: ViewStyle;
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => sortedB[i] === v);
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
  style,
}: MultiSelectorProps<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [query, setQuery] = useState('');
  const triggerRef = useRef<View>(null);

  function measureTrigger() {
    if (triggerRef.current) {
      triggerRef.current.measureInWindow((x, y, w, h) => {
        setPos({ top: y + h + 4, left: x, width: w });
      });
    }
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery('');
  }

  const selectedOptions = options.filter((o) => values.includes(o.value));

  /**
   * Opciones filtradas por la query de búsqueda. La búsqueda es
   * case-insensitive y tolera acentos (NFD + strip combining marks) para que
   * "IVA" coincida con "iva" y "impuesto" con "Impuesto".
   */
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

  return (
    <View style={style}>
      {label && <Text style={styles.label}>{label}</Text>}

      <Pressable
        ref={triggerRef}
        onPress={() =>
          !disabled && (open ? setOpen(false) : measureTrigger())
        }
        disabled={disabled}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.triggerPressed,
          disabled && styles.disabled,
        ]}
      >
        {selectedOptions.length === 0 ? (
          <Text style={[styles.triggerText, styles.placeholder]}>{placeholder}</Text>
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
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.text.secondary} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kavRoot}
        >
          {/* Backdrop con TouchableWithoutFeedback: no intercepta eventos
              que van al popover (a diferencia de Pressable en algunas versiones
              de RN con Modal transparent). */}
          <View style={styles.modalRoot}>
            <Pressable style={styles.backdrop} onPress={close} />
            <View
              style={[
                styles.popover,
                { top: pos.top, left: pos.left, width: pos.width },
              ]}
            >
              <View style={styles.popoverHeader}>
                <Text style={styles.modalHint}>
                  {values.length === 0
                    ? 'Toca para agregar'
                    : `${values.length} seleccionado${values.length === 1 ? '' : 's'}`}
                  {max ? ` (máx. ${max})` : ''}
                </Text>
                {values.length > 0 && (
                  <Pressable onPress={clear} hitSlop={8}>
                    <Text style={styles.clearText}>Limpiar</Text>
                  </Pressable>
                )}
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
                      : 'No hay opciones disponibles'}
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
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/**
 * Input de búsqueda con borde primary en focus (mirror del estilo web
 * `focus:ring-2 focus:ring-[var(--color-ring)] focus:border-[var(--color-primary)]`).
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
        autoFocus
        // Forzar `selectTextOnFocus` para que el cursor se posicione correctamente
        // al volver a focus después de un evento que momentáneamente lo quite.
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
    backgroundColor: colorScales.gray[50],
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
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Contenedor raíz del Modal (necesario para que KeyboardAvoidingView mida
  // correctamente el alto disponible cuando aparece el teclado).
  kavRoot: {
    flex: 1,
  },
  modalRoot: {
    flex: 1,
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
  // Estructura del popover (dropdown) que aparece al abrir el selector.
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
  },
  clearText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: '500',
  },
  popover: {
    position: 'absolute',
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  list: {
    maxHeight: 400,
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
  // Indicador checkbox a la izquierda de cada opción (espejo de la web)
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
  // Búsqueda en el popover (cuando `searchable` está activo)
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
    // Simula el `focus:ring-2` de la web: sombra tenue con color primary
    ...Platform.select({
      ios: { shadowColor: colors.primary, shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
      android: { elevation: 2 },
    }),
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