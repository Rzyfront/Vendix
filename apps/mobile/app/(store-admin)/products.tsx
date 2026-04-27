import { useState, useCallback } from 'react';
import { FlatList, Pressable, TouchableOpacity, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
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

const STATE_FILTERS: { label: string; value?: ProductState }[] = [
  { label: 'Todos' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
];

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
    <Pressable onPress={onPress} className="flex-1 max-w-[50%]">
      <Card className="m-1 p-0 overflow-hidden">
        <View className="aspect-square bg-gray-100 items-center justify-center">
          {product.image_url ? (
            <View className="w-full h-full bg-gray-200 items-center justify-center">
              <Icon name="image" size={32} color="#9ca3af" />
            </View>
          ) : (
            <Icon name="package" size={32} color="#9ca3af" />
          )}
        </View>
        <View className="p-3 gap-1">
          <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100" numberOfLines={2}>
            {product.name}
          </Text>
          <Text className="text-base font-bold text-gray-900 dark:text-gray-100">
            {formatCurrency(product.final_price)}
          </Text>
          <View className="flex-row gap-1 flex-wrap mt-1">
            <Badge label={product.state} variant={stateVariant} size="sm" />
            <Badge label={stockLabel} variant={stockVariant} size="sm" />
          </View>
        </View>
      </Card>
    </Pressable>
  );
};

const StatsGrid = ({ stats }: { stats: ProductStats | undefined }) => (
  <View className="flex-row flex-wrap gap-3 p-4">
    <View className="w-[48%]">
      <StatsCard label="Total" value={String(stats?.total_products ?? 0)} icon="package" />
    </View>
    <View className="w-[48%]">
      <StatsCard label="Activos" value={String(stats?.active_products ?? 0)} icon="tag" />
    </View>
    <View className="w-[48%]">
      <StatsCard label="Bajo Stock" value={String(stats?.low_stock_products ?? 0)} icon="filter" />
    </View>
    <View className="w-[48%]">
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
          className={`px-4 py-2 rounded-full mr-2 ${
            isActive ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <Text className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
            {item.label}
          </Text>
        </TouchableOpacity>
      );
    }}
    className="px-4 py-2"
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
      <View className="flex-1 items-center justify-center">
        <Spinner />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-gray-950">
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
        contentContainerClassName="pb-24 px-2"
      />
      <TouchableOpacity
        onPress={() => router.push('/products/create')}
        className="absolute bottom-6 right-6 w-14 h-14 rounded-full bg-blue-600 items-center justify-center shadow-lg"
      >
        <Icon name="plus" size={24} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
};
