import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { useQuery } from '@tanstack/react-query';
import { ProductService } from '@/features/store/services';

interface FilterOption {
  id: string | number;
  name: string;
}

interface FilterValues {
  state: string;
  category_id: string;
  brand_id: string;
  product_type: string;
}

interface PosFilterModalProps {
  visible: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

export function PosFilterModal({
  visible,
  onClose,
  onApplyFilters,
  currentFilters = { state: '', category_id: '', brand_id: '', product_type: '' },
}: PosFilterModalProps) {
  const [selectedState, setSelectedState] = useState(currentFilters.state);
  const [selectedCategory, setSelectedCategory] = useState(currentFilters.category_id);
  const [selectedBrand, setSelectedBrand] = useState(currentFilters.brand_id);
  const [selectedType, setSelectedType] = useState(currentFilters.product_type);

  // Load categories
  const { data: categories = [] } = useQuery({
    queryKey: ['pos-categories'],
    queryFn: () => ProductService.getCategories(),
    enabled: visible,
  });

  // Load brands
  const { data: brands = [] } = useQuery({
    queryKey: ['pos-brands'],
    queryFn: () => ProductService.getBrands(),
    enabled: visible,
  });

  const stateOptions = [
    { id: '', name: 'Todos' },
    { id: 'active', name: 'Activo' },
    { id: 'inactive', name: 'Inactivo' },
    { id: 'archived', name: 'Archivado' },
  ];

  const typeOptions = [
    { id: '', name: 'Todos' },
    { id: 'product', name: 'Producto' },
    { id: 'service', name: 'Servicio' },
  ];

  const handleApply = () => {
    onApplyFilters({
      state: selectedState,
      category_id: selectedCategory,
      brand_id: selectedBrand,
      product_type: selectedType,
    });
    onClose();
  };

  const handleClear = () => {
    setSelectedState('');
    setSelectedCategory('');
    setSelectedBrand('');
    setSelectedType('');
    onApplyFilters({
      state: '',
      category_id: '',
      brand_id: '',
      product_type: '',
    });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Icon name="x" size={24} color={colorScales.gray[700]} />
          </Pressable>
          <Text style={styles.title}>Filtros</Text>
          <Pressable onPress={handleClear} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Limpiar</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.content}>
          {/* Estado */}
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Estado</Text>
            <View style={styles.optionsGrid}>
              {stateOptions.map((option) => (
                <Pressable
                  key={option.id}
                  style={[
                    styles.optionBtn,
                    selectedState === option.id && styles.optionBtnActive,
                  ]}
                  onPress={() => setSelectedState(option.id)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      selectedState === option.id && styles.optionTextActive,
                    ]}
                  >
                    {option.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Tipo */}
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Tipo</Text>
            <View style={styles.optionsGrid}>
              {typeOptions.map((option) => (
                <Pressable
                  key={option.id}
                  style={[
                    styles.optionBtn,
                    selectedType === option.id && styles.optionBtnActive,
                  ]}
                  onPress={() => setSelectedType(option.id)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      selectedType === option.id && styles.optionTextActive,
                    ]}
                  >
                    {option.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Categoría */}
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Categoría</Text>
            <ScrollView
              style={styles.optionsListScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              <Pressable
                style={[
                  styles.listOptionBtn,
                  selectedCategory === '' && styles.listOptionBtnActive,
                ]}
                onPress={() => setSelectedCategory('')}
              >
                <Text
                  style={[
                    styles.listOptionText,
                    selectedCategory === '' && styles.listOptionTextActive,
                  ]}
                >
                  Todas las Categorías
                </Text>
              </Pressable>
              {(categories as FilterOption[]).map((category) => (
                <Pressable
                  key={category.id}
                  style={[
                    styles.listOptionBtn,
                    selectedCategory === String(category.id) && styles.listOptionBtnActive,
                  ]}
                  onPress={() => setSelectedCategory(String(category.id))}
                >
                  <Text
                    style={[
                      styles.listOptionText,
                      selectedCategory === String(category.id) && styles.listOptionTextActive,
                    ]}
                  >
                    {category.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Marca */}
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Marca</Text>
            <ScrollView
              style={styles.optionsListScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              <Pressable
                style={[
                  styles.listOptionBtn,
                  selectedBrand === '' && styles.listOptionBtnActive,
                ]}
                onPress={() => setSelectedBrand('')}
              >
                <Text
                  style={[
                    styles.listOptionText,
                    selectedBrand === '' && styles.listOptionTextActive,
                  ]}
                >
                  Todas las Marcas
                </Text>
              </Pressable>
              {(brands as FilterOption[]).map((brand) => (
                <Pressable
                  key={brand.id}
                  style={[
                    styles.listOptionBtn,
                    selectedBrand === String(brand.id) && styles.listOptionBtnActive,
                  ]}
                  onPress={() => setSelectedBrand(String(brand.id))}
                >
                  <Text
                    style={[
                      styles.listOptionText,
                      selectedBrand === String(brand.id) && styles.listOptionTextActive,
                    ]}
                  >
                    {brand.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable style={styles.applyBtn} onPress={handleApply}>
            <Text style={styles.applyBtnText}>Aplicar Filtros</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  clearBtn: {
    width: 60,
    alignItems: 'flex-end',
  },
  clearBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colors.error,
  },
  content: {
    flex: 1,
  },
  filterSection: {
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: spacing[3],
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  optionBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[100],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  optionBtnActive: {
    backgroundColor: colorScales.green[100],
    borderColor: colors.primary,
  },
  optionText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.medium as any,
  },
  optionTextActive: {
    color: colors.primary,
  },
  optionsList: {
    gap: spacing[2],
  },
  optionsListScroll: {
    maxHeight: 180,
  },
  listOptionBtn: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  listOptionBtnActive: {
    backgroundColor: colorScales.green[100],
    borderColor: colors.primary,
  },
  listOptionText: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  listOptionTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  applyBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
