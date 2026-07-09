import React, { useState, useEffect } from 'react';
import { View, Pressable, StyleSheet, TextInput, Text } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface PosSearchBarProps {
  onSearch: (query: string) => void;
  onOpenFilters: () => void;
  onOpenAdd: () => void;
  selectedCustomer?: any;
  /**
   * Cantidad de filtros activos (excluyendo search). Se pinta como badge
   * circular sobre el icono `filter` — paridad web `.filter-count`.
   */
  activeFiltersCount?: number;
  /**
   * Cuando es `true` el botón filter se renderiza en estado "active"
   * (primary bg + icono blanco) — paridad web `.filter-toggle-btn.active`.
   */
  filtersOpen?: boolean;
}

export function PosSearchBar({
  onSearch,
  onOpenFilters,
  onOpenAdd,
  selectedCustomer,
  activeFiltersCount = 0,
  filtersOpen = false,
}: PosSearchBarProps) {
  const [query, setQuery] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, onSearch]);

  return (
    <View style={styles.searchWrapper}>
      {/* Search Input */}
      <View style={styles.searchInput}>
        <View style={styles.searchIcon}>
          <Icon name="search" size={18} color={colorScales.gray[400]} />
        </View>
        <TextInput
          style={styles.searchTextInput}
          placeholder="Buscar productos..."
          placeholderTextColor={colorScales.gray[400]}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Icon name="x" size={16} color={colorScales.gray[400]} />
          </Pressable>
        )}
      </View>

      {/* Filter Button — paridad web `filter-toggle-btn`:
          - bg gray[100], border primary
          - active (filtersOpen) → bg primary, icon blanco
          - badge circular con count si activeFiltersCount > 0 */}
      <Pressable
        style={[styles.filterBtn, filtersOpen && styles.filterBtnActive]}
        onPress={onOpenFilters}
      >
        <Icon
          name="filter"
          size={18}
          color={filtersOpen ? '#FFFFFF' : colors.primary}
        />
        {activeFiltersCount > 0 && (
          <View style={styles.filterBadge}>
            <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
          </View>
        )}
      </Pressable>

      {/* Add Button — icono user-check / user-plus (paridad web `pos-product-selection.component`):
          el CTA de "agregar/ver cliente" usa `user-check` con stroke 2, color primary
          cuando hay cliente seleccionado, `user-plus` con color gray[600] cuando no. */}
      <Pressable
        style={[
          styles.addBtn,
          selectedCustomer && styles.addBtnActive
        ]}
        onPress={onOpenAdd}
      >
        <Icon
          name={selectedCustomer ? 'user-check' : 'user-plus'}
          size={18}
          color={selectedCustomer ? colors.primary : colorScales.gray[600]}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  searchInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    minHeight: 40,
  },
  searchIcon: {
    marginRight: spacing[2],
  },
  searchTextInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
    height: '100%',
  },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Estado activo (paridad web `.filter-toggle-btn.active`).
  filterBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  // Badge circular (paridad web `.filter-count { background:#ef4444; width:20;
  // height:20; border-radius:50%; font-size:12 }`). Usamos error para
  // destacar visualmente sobre el primary bg.
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.error,
    borderWidth: 1.5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
  },
});