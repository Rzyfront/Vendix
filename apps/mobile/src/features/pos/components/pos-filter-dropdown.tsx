import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { useQuery } from '@tanstack/react-query';
import { ProductService } from '@/features/store/services';

interface FilterOption {
  id: string | number;
  name: string;
}

interface FilterValues {
  category_id: string;
  brand_id: string;
}

interface PosFilterDropdownProps {
  visible: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

export function PosFilterDropdown({
  visible,
  onClose,
  onApplyFilters,
  currentFilters = { category_id: '', brand_id: '' },
}: PosFilterDropdownProps) {
  const [selectedCategory, setSelectedCategory] = useState(currentFilters.category_id);
  const [selectedBrand, setSelectedBrand] = useState(currentFilters.brand_id);

  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);

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

  const handleApply = () => {
    onApplyFilters({
      category_id: selectedCategory,
      brand_id: selectedBrand,
    });
    onClose();
  };

  const handleClear = () => {
    setSelectedCategory('');
    setSelectedBrand('');
    onApplyFilters({
      category_id: '',
      brand_id: '',
    });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.dropdown} onPress={() => {}}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Filtros</Text>
            <Pressable onPress={handleClear}>
              <Text style={styles.clearText}>Limpiar</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.content}>
            {/* Categoría */}
            <View style={styles.filterSection}>
              <Text style={styles.filterLabel}>Categoría</Text>
              <Pressable
                style={styles.selectBtn}
                onPress={() => {
                  setShowCategoryDropdown(!showCategoryDropdown);
                  setShowBrandDropdown(false);
                }}
              >
                <Text style={styles.selectText}>{getCategoryName(selectedCategory)}</Text>
                <Icon name="chevron-down" size={16} color={colorScales.gray[500]} />
              </Pressable>
              {showCategoryDropdown && (
                <View style={styles.dropdownList}>
                  <Pressable
                    style={styles.dropdownItem}
                    onPress={() => {
                      setSelectedCategory('');
                      setShowCategoryDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>Todas las categorías</Text>
                    {selectedCategory === '' && (
                      <Icon name="check" size={16} color={colors.primary} />
                    )}
                  </Pressable>
                  {(categories as FilterOption[]).map((category) => (
                    <Pressable
                      key={category.id}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setSelectedCategory(String(category.id));
                        setShowCategoryDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{category.name}</Text>
                      {selectedCategory === String(category.id) && (
                        <Icon name="check" size={16} color={colors.primary} />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Marca */}
            <View style={styles.filterSection}>
              <Text style={styles.filterLabel}>Marca</Text>
              <Pressable
                style={styles.selectBtn}
                onPress={() => {
                  setShowBrandDropdown(!showBrandDropdown);
                  setShowCategoryDropdown(false);
                }}
              >
                <Text style={styles.selectText}>{getBrandName(selectedBrand)}</Text>
                <Icon name="chevron-down" size={16} color={colorScales.gray[500]} />
              </Pressable>
              {showBrandDropdown && (
                <View style={styles.dropdownList}>
                  <Pressable
                    style={styles.dropdownItem}
                    onPress={() => {
                      setSelectedBrand('');
                      setShowBrandDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>Todas las marcas</Text>
                    {selectedBrand === '' && (
                      <Icon name="check" size={16} color={colors.primary} />
                    )}
                  </Pressable>
                  {(brands as FilterOption[]).map((brand) => (
                    <Pressable
                      key={brand.id}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setSelectedBrand(String(brand.id));
                        setShowBrandDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{brand.name}</Text>
                      {selectedBrand === String(brand.id) && (
                        <Icon name="check" size={16} color={colors.primary} />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable style={styles.applyBtn} onPress={handleApply}>
              <Text style={styles.applyBtnText}>Aplicar Filtros</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingTop: 60,
  },
  dropdown: {
    marginHorizontal: spacing[4],
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    maxHeight: 500,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  clearText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colors.error,
  },
  content: {
    maxHeight: 350,
  },
  filterSection: {
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginBottom: spacing[2],
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  selectText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  dropdownList: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    marginTop: 4,
    maxHeight: 200,
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
  footer: {
    padding: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  applyBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
