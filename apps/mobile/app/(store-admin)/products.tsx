import { useState, useCallback } from 'react';
import { FlatList, Pressable, TouchableOpacity, Text, View, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { usePagination } from '@/core/hooks/use-pagination';
import { formatCurrency } from '@/shared/utils/currency';
import { ProductService } from '@/features/store/services';
import { useTenantStore } from '@/core/store/tenant.store';
import type { Product, ProductState, ProductStats } from '@/features/store/types';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Badge } from '@/shared/components/badge/badge';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, borderRadius, shadows, typography } from '@/shared/theme';

const STATE_FILTERS: { label: string; value?: ProductState }[] = [
  { label: 'Todos' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
];

const productCardStyles = StyleSheet.create({
  wrapper: {
    flex: 1,
    maxWidth: '50%',
  },
  cardInner: {
    margin: spacing[1],
    overflow: 'hidden',
  },
  imageArea: {
    aspectRatio: 1,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImage: {
    width: '100%',
    height: '100%',
    borderRadius: borderRadius.md,
  },
  content: {
    padding: spacing[3],
    gap: spacing[1],
  },
  name: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  price: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing[1],
    flexWrap: 'wrap',
    marginTop: spacing[1],
  },
});

const statsGridStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    padding: spacing[4],
  },
  item: {
    width: '48%',
  },
});

const filterStyles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  chipActive: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    marginRight: spacing[2],
    backgroundColor: colorScales.blue[600],
  },
  chipInactive: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    marginRight: spacing[2],
    backgroundColor: colorScales.gray[200],
  },
  chipTextActive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.background,
  },
  chipTextInactive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
});

const screenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[6],
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.blue[600],
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
});

const ProductCard = ({ product, onPress }: { product: Product; onPress: () => void }) => {
  const stateVariant = product.state === 'active' ? 'success' : product.state === 'inactive' ? 'warning' : 'default';
  const stockVariant =
    (product.stock_quantity ?? 0) === 0
      ? 'error'
      : (product.stock_quantity ?? 0) <= 5
        ? 'warning'
        : 'success';
  const stockLabel =
    (product.stock_quantity ?? 0) === 0
      ? 'Sin stock'
      : (product.stock_quantity ?? 0) <= 5
        ? `Stock bajo: ${product.stock_quantity}`
        : `Stock: ${product.stock_quantity}`;

  return (
    <Pressable onPress={onPress} style={productCardStyles.wrapper}>
      <Card style={productCardStyles.cardInner}>
        <View style={productCardStyles.imageArea}>
          {product.image_url ? (
            <Image source={{ uri: product.image_url }} style={productCardStyles.productImage} />
          ) : (
            <Icon name="package" size={32} color={colorScales.gray[400]} />
          )}
        </View>
        <View style={productCardStyles.content}>
          <Text style={productCardStyles.name} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={productCardStyles.price}>
            {formatCurrency(product.final_price)}
          </Text>
          <View style={productCardStyles.badgeRow}>
            <Badge label={product.state} variant={stateVariant} size="sm" />
            <Badge label={stockLabel} variant={stockVariant} size="sm" />
          </View>
        </View>
      </Card>
    </Pressable>
  );
};

const StatsGrid = ({ stats }: { stats: ProductStats | undefined }) => (
  <View style={statsGridStyles.container}>
    <View style={statsGridStyles.item}>
      <StatsCard label="Total" value={String(stats?.total_products ?? 0)} icon="package" />
    </View>
    <View style={statsGridStyles.item}>
      <StatsCard label="Activos" value={String(stats?.active_products ?? 0)} icon="tag" />
    </View>
    <View style={statsGridStyles.item}>
      <StatsCard label="Bajo Stock" value={String(stats?.low_stock_products ?? 0)} icon="filter" />
    </View>
    <View style={statsGridStyles.item}>
      <StatsCard label="Valor Total" value={formatCurrency(stats?.total_value ?? 0)} icon="tag" />
    </View>
  </View>
);

const FilterChips = ({
  activeFilter,
  onSelect,
}: {
  activeFilter?: ProductState;
  onSelect: (value?: ProductState) => void;
}) => (
  <FlatList
    horizontal
    showsHorizontalScrollIndicator={false}
    data={STATE_FILTERS}
    keyExtractor={(item) => item.label}
    renderItem={({ item }) => {
      const isActive = item.value === activeFilter;
      return (
        <TouchableOpacity
          onPress={() => onSelect(item.value)}
          style={isActive ? filterStyles.chipActive : filterStyles.chipInactive}
        >
          <Text style={isActive ? filterStyles.chipTextActive : filterStyles.chipTextInactive}>
            {item.label}
          </Text>
        </TouchableOpacity>
      );
    }}
    style={filterStyles.list}
  />
);

export default function ProductsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<ProductState | undefined>();
  const { page, limit, setTotal, totalPages, hasNextPage, setPage } = usePagination();
  const storeId = useTenantStore((s) => s.storeId);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['product-stats', storeId],
    queryFn: () => ProductService.stats(Number(storeId) || 0),
    enabled: !!storeId,
  });

  const {
    data: productsData,
    isLoading: productsLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['products', page, search, stateFilter],
    queryFn: async () => {
      const result = await ProductService.list({ page, limit, search, state: stateFilter });
      setTotal(result.pagination.total);
      return result;
    },
  });

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, [setPage]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage) setPage(page + 1);
  }, [hasNextPage, page, setPage]);

  const renderProduct = useCallback(
    ({ item }: { item: Product }) => (
      <ProductCard product={item} onPress={() => router.push(`/products/${item.id}`)} />
    ),
    [router],
  );

  if (productsLoading && !productsData) {
    return (
      <View style={screenStyles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={screenStyles.root}>
      <StatsGrid stats={stats} />
      <SearchBar value={search} onSubmit={handleSearch} onClear={() => handleSearch('')} placeholder="Buscar productos..." />
      <FilterChips activeFilter={stateFilter} onSelect={(v) => { setStateFilter(v); setPage(1); }} />
      <FlatList
        data={productsData?.data ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderProduct}
        numColumns={2}
        refreshing={isRefetching}
        onRefresh={refetch}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          <EmptyState
            title="Sin productos"
            description="Aún no tienes productos registrados"
            actionLabel="Crear producto"
            onAction={() => router.push('/products/create')}
            icon="package"
          />
        }
        ListFooterComponent={productsLoading && productsData ? <Spinner /> : null}
        contentContainerStyle={{ paddingBottom: spacing[24], paddingHorizontal: spacing[2] }}
      />
      <TouchableOpacity
        onPress={() => router.push('/products/create')}
        style={screenStyles.fab}
      >
        <Icon name="plus" size={24} color={colors.background} />
      </TouchableOpacity>
    </View>
  );
};
