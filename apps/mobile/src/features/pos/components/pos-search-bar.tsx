import React, { useState, useCallback, useEffect } from 'react';
import { View, Pressable, StyleSheet, TextInput } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface PosSearchBarProps {
  onSearch: (query: string) => void;
  onOpenFilters: () => void;
  onOpenAdd: () => void;
  selectedCustomer?: { name: string } | null;
}

export function PosSearchBar({
  onSearch,
  onOpenFilters,
  onOpenAdd,
  selectedCustomer,
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

      {/* Filter Button */}
      <Pressable style={styles.filterBtn} onPress={onOpenFilters}>
        <Icon name="filter" size={18} color={colors.primary} />
      </Pressable>

      {/* Add Button (+) */}
      <Pressable
        style={styles.addBtn}
        onPress={onOpenAdd}
      >
        <Icon name="plus" size={20} color={colors.primary} />
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
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
