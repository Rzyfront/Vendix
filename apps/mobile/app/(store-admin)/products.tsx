import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { usePagination } from '@/core/hooks/use-pagination';
import { useTenantStore } from '@/core/store/tenant.store';
import { ProductService } from '@/features/store/services';
import type { Product, ProductState, ProductStats } from '@/features/store/types';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Icon } from '@/shared/components/icon/icon';
import { RecordCard } from '@/shared/components/record-card/record-card';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { formatCurrency } from '@/shared/utils/currency';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

const STATE_FILTERS: { label: string; value?: ProductState }[] = [
  { label: 'Todos' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
];

function stateLabel(state: ProductState): string {
  if (state === 'active') return 'Activo';
  if (state === 'inactive') return 'Inactivo';
  return 'Archivado';
}

function stateVariant(state: ProductState) {
  if (state === 'active') return 'success' as const;
  if (state === 'inactive') return 'warning' as const;
  return 'default' as const;
}

function getStockInfo(product: Product) {
  if (product.track_inventory === false) {
    return { label: 'Sin control', variant: 'info' as const, value: 'No controla' };
  }

  const stock = Number(product.total_stock_available ?? product.stock_quantity ?? 0);
  if (stock <= 0) {
    return { label: 'Sin stock', variant: 'error' as const, value: '0 unidades' };
  }
  if (stock <= 5) {
    return { label: 'Stock bajo', variant: 'warning' as const, value: `${stock} unidades` };
  }
  return { label: 'En stock', variant: 'success' as const, value: `${stock} unidades` };
}

const ProductCard = ({ product, onPress }: { product: Product; onPress: () => void }) => {
  const stock = getStockInfo(product);
  const variantCount = product.product_variants?.length ?? 0;
  const categories = product.categories?.map((category) => category.name).join(', ');
  const subtitle = [product.sku ? `SKU ${product.sku}` : undefined, product.brand?.name, categories]
    .filter(Boolean)
    .join(' · ');

  return (
    <RecordCard
      title={product.name}
      subtitle={subtitle || 'Producto físico'}
      media={{ imageUri: product.image_url, icon: 'package' }}
      badges={[
        { label: stateLabel(product.state), variant: stateVariant(product.state) },
        { label: stock.label, variant: stock.variant },
      ]}
      details={[
        { label: 'SKU', value: product.sku || 'Sin SKU', icon: 'barcode' },
        { label: 'Stock', value: stock.value, icon: 'warehouse' },
        { label: 'Variantes', value: variantCount > 0 ? String(variantCount) : 'No', icon: 'grid' },
        {
          label: 'Ecommerce',
          value: product.available_for_ecommerce === false ? 'Oculto' : 'Visible',
          icon: 'store',
        },
      ]}
      footerLabel="Precio"
      footerValue={formatCurrency(product.final_price ?? product.base_price ?? 0)}
      footerTone="success"
      onPress={onPress}
    />
  );
};

const ProductStatsGrid = ({ stats }: { stats: ProductStats | undefined }) => (
  <StatsGrid
    items={[
      { label: 'Total', value: String(stats?.total_products ?? 0), icon: 'package' },
      { label: 'Valor Total', value: formatCurrency(stats?.total_value ?? 0), icon: 'dollar-sign' },
    ]}
  />
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
    contentContainerStyle={styles.filterList}
    renderItem={({ item }) => {
      const isActive = item.value === activeFilter;
      return (
        <Pressable
          onPress={() => onSelect(item.value)}
          style={[styles.filterChip, isActive ? styles.filterChipActive : styles.filterChipInactive]}
        >
          <Text style={isActive ? styles.filterTextActive : styles.filterTextInactive}>
            {item.label}
          </Text>
        </Pressable>
      );
    }}
  />
);

export default function ProductsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<ProductState | undefined>();
  const { page, limit, setTotal, hasNextPage, setPage } = usePagination();
  const storeId = useTenantStore((s) => s.storeId);

  const { data: stats } = useQuery({
    queryKey: ['product-stats', storeId],
    queryFn: () => ProductService.stats(Number(storeId) || 0),
    enabled: !!storeId,
  });

  const {
    data: productsData,
    isLoading: productsLoading,
    isError: productsError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['products', page, search, stateFilter],
    queryFn: async () => {
      const result = await ProductService.list({
        page,
        limit,
        search,
        state: stateFilter,
        include_variants: true,
      });
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
      <ProductCard
        product={item}
        onPress={() => router.push(`/(store-admin)/products/${item.id}` as never)}
      />
    ),
    [router],
  );

  if (productsLoading && !productsData) {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  if (productsError && !productsData) {
    return (
      <View style={styles.root}>
        <EmptyState
          title="No se pudieron cargar los productos"
          description="Revisa tu sesión o conexión e intenta de nuevo."
          actionLabel="Reintentar"
          onAction={() => refetch()}
          icon="package"
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={productsData?.data ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderProduct}
        refreshing={isRefetching}
        onRefresh={refetch}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            <ProductStatsGrid stats={stats} />
            <View style={styles.searchWrap}>
              <SearchBar
                value={search}
                onChangeText={handleSearch}
                onClear={() => handleSearch('')}
                placeholder="Buscar productos..."
              />
            </View>
            <FilterChips
              activeFilter={stateFilter}
              onSelect={(value) => {
                setStateFilter(value);
                setPage(1);
              }}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin productos"
            description="Aún no tienes productos registrados"
            actionLabel="Crear producto"
            onAction={() => router.push('/(store-admin)/products/create' as never)}
            icon="package"
          />
        }
        ListFooterComponent={productsLoading && productsData ? <Spinner /> : null}
        contentContainerStyle={styles.listContent}
      />

      <Pressable
        onPress={() => router.push('/(store-admin)/products/create' as never)}
        style={styles.fab}
      >
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  searchWrap: {
    marginBottom: spacing[3],
  },
  filterList: {
    paddingBottom: spacing[4],
    gap: spacing[2],
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipInactive: {
    backgroundColor: colors.background,
    borderColor: colorScales.gray[200],
  },
  filterTextActive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.background,
  },
  filterTextInactive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[24],
  },
  separator: {
    height: spacing[3],
  },
  fab: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[6],
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
});
