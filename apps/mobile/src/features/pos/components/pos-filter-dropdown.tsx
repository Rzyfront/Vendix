import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { useQuery } from '@tanstack/react-query';
import { ProductService } from '@/features/store/services';

interface FilterOption {
  id: string | number;
  name: string;
}

/**
 * Paridad 1:1 con el shape web `SearchFilters` (`pos-product-search.component.ts`).
 * El backend actual sólo respeta `category_id` / `brand_id` / `search`; los
 * demás se aplican como fallback en cliente (`pos/index.tsx`).
 */
export interface PosFilterValues {
  category_id: string;
  brand_id: string;
  min_price: string;
  max_price: string;
  in_stock: boolean;
  sort_by: '' | 'name' | 'price' | 'stock' | 'createdAt';
  sort_order: 'asc' | 'desc';
}

const EMPTY_FILTERS: PosFilterValues = {
  category_id: '',
  brand_id: '',
  min_price: '',
  max_price: '',
  in_stock: false,
  sort_by: '',
  sort_order: 'asc',
};

interface PosFilterDropdownProps {
  visible: boolean;
  onClose: () => void;
  onApplyFilters: (filters: PosFilterValues) => void;
  currentFilters?: PosFilterValues;
}

/**
 * Devuelve el número de filtros activos (excluyendo search). Se usa también
 * en `pos-search-bar` para pintar la badge circular sobre el icono filter.
 */
export function countActiveFilters(f: PosFilterValues): number {
  let n = 0;
  if (f.category_id) n++;
  if (f.brand_id) n++;
  if (f.min_price) n++;
  if (f.max_price) n++;
  if (f.in_stock) n++;
  if (f.sort_by) n++;
  return n;
}

const SORT_OPTIONS: { value: NonNullable<PosFilterValues['sort_by']>; label: string }[] = [
  { value: 'name', label: 'Nombre' },
  { value: 'price', label: 'Precio' },
  { value: 'stock', label: 'Stock' },
  { value: 'createdAt', label: 'Fecha de creación' },
];

export function PosFilterDropdown({
  visible,
  onClose,
  onApplyFilters,
  currentFilters,
}: PosFilterDropdownProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<PosFilterValues>(currentFilters ?? EMPTY_FILTERS);

  // Re-sincronizar el draft cuando se abre el modal con nuevos valores.
  useEffect(() => {
    if (visible) setDraft(currentFilters ?? EMPTY_FILTERS);
  }, [visible, currentFilters]);

  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['pos-categories'],
    queryFn: () => ProductService.getCategories(),
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['pos-brands'],
    queryFn: () => ProductService.getBrands(),
  });

  const getCategoryName = (id: string) => {
    if (!id) return 'Todas las categorías';
    const cat = (categories as FilterOption[]).find((c) => String(c.id) === id);
    return cat?.name || 'Todas las categorías';
  };
  const getBrandName = (id: string) => {
    if (!id) return 'Todas las marcas';
    const brand = (brands as FilterOption[]).find((b) => String(b.id) === id);
    return brand?.name || 'Todas las marcas';
  };
  const getSortLabel = (v: PosFilterValues['sort_by']) =>
    SORT_OPTIONS.find((o) => o.value === v)?.label ?? 'Relevancia';

  const handleApply = () => {
    onApplyFilters(draft);
    onClose();
  };
  const handleClear = () => {
    setDraft({ ...EMPTY_FILTERS });
    onApplyFilters({ ...EMPTY_FILTERS });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.container} onPress={(e) => e.stopPropagation()}>
            {/* Header — paridad web: "Filtros" + acción "Limpiar" inline */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIcon}>
                  <Icon name="filter" size={18} color={colors.primary} />
                </View>
                <View>
                  <Text style={styles.title}>Filtros</Text>
                  <Text style={styles.subtitle}>
                    {countActiveFilters(draft) > 0
                      ? `${countActiveFilters(draft)} activo${countActiveFilters(draft) > 1 ? 's' : ''}`
                      : 'Refina los resultados'}
                  </Text>
                </View>
              </View>
              <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                <Icon name="x" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.grid}>
                {/* Categoría — paridad web */}
                <View style={styles.field}>
                  <Text style={styles.label}>Categoría</Text>
                  <Pressable
                    style={styles.select}
                    onPress={() => {
                      setShowCategoryDropdown((v) => !v);
                      setShowBrandDropdown(false);
                      setShowSortDropdown(false);
                    }}
                  >
                    <Text style={styles.selectText}>{getCategoryName(draft.category_id)}</Text>
                    <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                  </Pressable>
                  {showCategoryDropdown && (
                    <View style={styles.dropdown}>
                      <Pressable
                        style={styles.dropdownItem}
                        onPress={() => {
                          setDraft({ ...draft, category_id: '' });
                          setShowCategoryDropdown(false);
                        }}
                      >
                        <Text style={styles.dropdownItemText}>Todas las categorías</Text>
                        {draft.category_id === '' && (
                          <Icon name="check" size={16} color={colors.primary} />
                        )}
                      </Pressable>
                      {(categories as FilterOption[]).map((c) => (
                        <Pressable
                          key={c.id}
                          style={styles.dropdownItem}
                          onPress={() => {
                            setDraft({ ...draft, category_id: String(c.id) });
                            setShowCategoryDropdown(false);
                          }}
                        >
                          <Text style={styles.dropdownItemText}>{c.name}</Text>
                          {draft.category_id === String(c.id) && (
                            <Icon name="check" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {/* Marca — paridad web */}
                <View style={styles.field}>
                  <Text style={styles.label}>Marca</Text>
                  <Pressable
                    style={styles.select}
                    onPress={() => {
                      setShowBrandDropdown((v) => !v);
                      setShowCategoryDropdown(false);
                      setShowSortDropdown(false);
                    }}
                  >
                    <Text style={styles.selectText}>{getBrandName(draft.brand_id)}</Text>
                    <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                  </Pressable>
                  {showBrandDropdown && (
                    <View style={styles.dropdown}>
                      <Pressable
                        style={styles.dropdownItem}
                        onPress={() => {
                          setDraft({ ...draft, brand_id: '' });
                          setShowBrandDropdown(false);
                        }}
                      >
                        <Text style={styles.dropdownItemText}>Todas las marcas</Text>
                        {draft.brand_id === '' && (
                          <Icon name="check" size={16} color={colors.primary} />
                        )}
                      </Pressable>
                      {(brands as FilterOption[]).map((b) => (
                        <Pressable
                          key={b.id}
                          style={styles.dropdownItem}
                          onPress={() => {
                            setDraft({ ...draft, brand_id: String(b.id) });
                            setShowBrandDropdown(false);
                          }}
                        >
                          <Text style={styles.dropdownItemText}>{b.name}</Text>
                          {draft.brand_id === String(b.id) && (
                            <Icon name="check" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {/* Precio Mínimo — paridad web `<input type="number" step="0.01" min="0">` */}
                <View style={styles.field}>
                  <Text style={styles.label}>Precio Mínimo</Text>
                  <TextInput
                    style={styles.input}
                    value={draft.min_price}
                    onChangeText={(v) =>
                      setDraft({ ...draft, min_price: v.replace(/[^0-9.]/g, '') })
                    }
                    placeholder="0.00"
                    placeholderTextColor={colorScales.gray[400]}
                    keyboardType="decimal-pad"
                  />
                </View>

                {/* Precio Máximo — paridad web */}
                <View style={styles.field}>
                  <Text style={styles.label}>Precio Máximo</Text>
                  <TextInput
                    style={styles.input}
                    value={draft.max_price}
                    onChangeText={(v) =>
                      setDraft({ ...draft, max_price: v.replace(/[^0-9.]/g, '') })
                    }
                    placeholder="999.99"
                    placeholderTextColor={colorScales.gray[400]}
                    keyboardType="decimal-pad"
                  />
                </View>

                {/* Solo productos con stock — paridad web checkbox-label */}
                <View style={styles.field}>
                  <Text style={styles.label}>Disponibilidad</Text>
                  <Pressable
                    style={styles.checkboxRow}
                    onPress={() => setDraft({ ...draft, in_stock: !draft.in_stock })}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        draft.in_stock && styles.checkboxChecked,
                      ]}
                    >
                      {draft.in_stock && (
                        <Icon name="check" size={14} color="#FFFFFF" />
                      )}
                    </View>
                    <Text style={styles.checkboxLabel}>Solo productos con stock</Text>
                  </Pressable>
                </View>

                {/* Ordenar por — paridad web */}
                <View style={styles.field}>
                  <Text style={styles.label}>Ordenar por</Text>
                  <Pressable
                    style={styles.select}
                    onPress={() => {
                      setShowSortDropdown((v) => !v);
                      setShowCategoryDropdown(false);
                      setShowBrandDropdown(false);
                    }}
                  >
                    <Text style={styles.selectText}>{getSortLabel(draft.sort_by)}</Text>
                    <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                  </Pressable>
                  {showSortDropdown && (
                    <View style={styles.dropdown}>
                      <Pressable
                        style={styles.dropdownItem}
                        onPress={() => {
                          setDraft({ ...draft, sort_by: '', sort_order: 'asc' });
                          setShowSortDropdown(false);
                        }}
                      >
                        <Text style={styles.dropdownItemText}>Relevancia</Text>
                        {draft.sort_by === '' && (
                          <Icon name="check" size={16} color={colors.primary} />
                        )}
                      </Pressable>
                      {SORT_OPTIONS.map((opt) => (
                        <Pressable
                          key={opt.value}
                          style={styles.dropdownItem}
                          onPress={() => {
                            setDraft({ ...draft, sort_by: opt.value });
                            setShowSortDropdown(false);
                          }}
                        >
                          <Text style={styles.dropdownItemText}>{opt.label}</Text>
                          {draft.sort_by === opt.value && (
                            <Icon name="check" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {/* Orden — paridad web: aparece sólo si sort_by está set */}
                {draft.sort_by !== '' && (
                  <View style={styles.field}>
                    <Text style={styles.label}>Orden</Text>
                    <View style={styles.segmented}>
                      <Pressable
                        style={[
                          styles.segment,
                          draft.sort_order === 'asc' && styles.segmentActive,
                        ]}
                        onPress={() => setDraft({ ...draft, sort_order: 'asc' })}
                      >
                        <Icon
                          name="chevron-up"
                          size={14}
                          color={
                            draft.sort_order === 'asc'
                              ? '#FFFFFF'
                              : colorScales.gray[600]
                          }
                        />
                        <Text
                          style={[
                            styles.segmentText,
                            draft.sort_order === 'asc' && styles.segmentTextActive,
                          ]}
                        >
                          Ascendente
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.segment,
                          draft.sort_order === 'desc' && styles.segmentActive,
                        ]}
                        onPress={() => setDraft({ ...draft, sort_order: 'desc' })}
                      >
                        <Icon
                          name="chevron-down"
                          size={14}
                          color={
                            draft.sort_order === 'desc'
                              ? '#FFFFFF'
                              : colorScales.gray[600]
                          }
                        />
                        <Text
                          style={[
                            styles.segmentText,
                            draft.sort_order === 'desc' && styles.segmentTextActive,
                          ]}
                        >
                          Descendente
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Footer — paridad web `.filter-actions`: "Limpiar Filtros"
               + "Aplicar Filtros" primario */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[3] }]}>
              <Pressable style={styles.clearBtn} onPress={handleClear}>
                <Text style={styles.clearBtnText}>Limpiar Filtros</Text>
              </Pressable>
              <Pressable style={styles.applyBtn} onPress={handleApply}>
                <Icon name="check" size={16} color="#FFFFFF" />
                <Text style={styles.applyBtnText}>Aplicar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Backdrop — paridad con PosCustomItemModal / ShippingModal /
  // PosOrderCreateModal: rgba(15, 23, 42, 0.45), layout centered.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  // Container — paridad modales POS: maxWidth 520, maxHeight 90%, white bg,
  // border + shadow + elevation para que flote sobre el POS detrás.
  container: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    flex: 1,
  },
  // Tile decorativo con icono filter — paridad PosCustomItemModal /
  // PosOrderCreateModal (`headerIcon` 36×10 con bg primary/10).
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${colors.primary}1A`, // 10% alpha — paridad Tailwind bg-primary/10
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing[1],
  },
  body: {
    flex: 1,
    // Paridad web `.search-filters { background: #f9fafb }` — bloque gris
    // suave dentro del modal para diferenciar header/footer (white) del
    // cuerpo de filtros.
    backgroundColor: colorScales.gray[50],
  },
  bodyContent: {
    padding: spacing[5],
    paddingBottom: spacing[6],
  },
  // Grid — paridad web `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))`.
  // En mobile usamos 2 columnas para no perder densidad.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[4],
  },
  field: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 140,
    gap: spacing[2],
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  // Inputs / selects — paridad web `.filter-select` y `.filter-input`:
  // border 1px solid #d1d5db (gray[300]), border-radius 6, padding 8/12.
  input: {
    height: 40,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  select: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
  },
  selectText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  dropdown: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    marginTop: spacing[1],
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
      },
      android: { elevation: 6 },
    }),
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  dropdownItemText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  // Checkbox — paridad web `.checkbox-label` (input + texto en row).
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    height: 40,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colorScales.gray[300],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    flex: 1,
  },
  // Segmented (asc/desc) — equivalente visual a un `<select>` corto pero
  // mobile-friendly: dos botones lado a lado.
  segmented: {
    flexDirection: 'row',
    height: 40,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  // Footer — paridad web `.filter-actions`: secondary + primary CTA.
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    paddingHorizontal: spacing[5],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  clearBtn: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.background,
  },
  clearBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  applyBtn: {
    flex: 2,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
  },
  applyBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});

export const EMPTY_POS_FILTERS = EMPTY_FILTERS;