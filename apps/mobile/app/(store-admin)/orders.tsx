import { useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { OrderService } from '@/features/store/services/order.service';
import {
  Order,
  OrderState,
  ORDER_STATE_LABELS,
  ORDER_STATE_COLORS,
} from '@/features/store/types';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ListItem } from '@/shared/components/list-item/list-item';
import { formatCurrency } from '@/shared/utils/currency';
import { formatRelative } from '@/shared/utils/date';

const STATE_VARIANT_MAP: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  default: 'default',
  warning: 'warning',
  success: 'success',
  error: 'error',
  info: 'info',
};

type FilterChip = { label: string; value: OrderState | 'all' };

const FILTER_CHIPS: FilterChip[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Pendientes', value: 'pending_payment' },
  { label: 'Procesando', value: 'processing' },
  { label: 'Enviadas', value: 'shipped' },
  { label: 'Entregadas', value: 'delivered' },
  { label: 'Canceladas', value: 'cancelled' },
];

const CHANNEL_ICONS: Record<string, string> = {
  pos: 'clipboard-list',
  ecommerce: 'trending-up',
  agent: 'check',
  whatsapp: 'alert-triangle',
  marketplace: 'dollar-sign',
};

const OrderCard = ({ order, onPress }: { order: Order; onPress: () => void }) => {
  const badgeVariant =
    STATE_VARIANT_MAP[ORDER_STATE_COLORS[order.state]] ?? 'default';

  return (
    <Pressable onPress={onPress}>
      <Card className="mb-3">
        <View className="flex-row justify-between items-start mb-2">
          <View className="flex-1">
            <View className="flex-row items-center gap-2 mb-1">
              <ListItem
                title={`#${order.order_number}`}
                subtitle={
                  order.customer
                    ? `${order.customer.first_name} ${order.customer.last_name}`
                    : undefined
                }
              />
            </View>
          </View>
          <Badge
            label={ORDER_STATE_LABELS[order.state]}
            variant={badgeVariant}
            size="sm"
          />
        </View>

        <View className="flex-row justify-between items-center mt-2">
          <View className="flex-row items-center gap-1">
            {order.channel && (
              <Icon
                name={CHANNEL_ICONS[order.channel] ?? 'clipboard-list'}
                size={14}
                color="#6b7280"
              />
            )}
            <ListItem
              title={formatRelative(order.created_at)}
            />
          </View>
          <ListItem
            title={formatCurrency(order.grand_total)}
          />
        </View>
      </Card>
    </Pressable>
  );
};

const Orders = () => {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<OrderState | 'all'>('all');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['order-stats'],
    queryFn: () => OrderService.stats(),
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: ordersLoading,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['orders', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      OrderService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        status: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
    initialPageParam: 1,
  });

  const orders = data?.pages.flatMap((p) => p.data) ?? [];

  const handlePressOrder = (id: number) => {
    router.push(`/(store-admin)/orders/${id}`);
  };

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const renderItem = useCallback(
    ({ item }: { item: Order }) => (
      <OrderCard order={item} onPress={() => handlePressOrder(item.id)} />
    ),
    [],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return <Spinner />;
  }, [isFetchingNextPage]);

  return (
    <View className="flex-1 bg-gray-50">
      <FlatList
        data={orders}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <View className="flex-row flex-wrap gap-3 p-4">
              <View className="w-[48%]">
                <StatsCard
                  label="Total Órdenes"
                  value={stats?.total_orders ?? 0}
                  icon="clipboard-list"
                />
              </View>
              <View className="w-[48%]">
                <StatsCard
                  label="Ingresos"
                  value={formatCurrency(stats?.total_revenue ?? 0)}
                  icon="dollar-sign"
                />
              </View>
              <View className="w-[48%]">
                <StatsCard
                  label="Pendientes"
                  value={stats?.pending_orders ?? 0}
                  icon="clock"
                />
              </View>
              <View className="w-[48%]">
                <StatsCard
                  label="Completadas"
                  value={stats?.completed_orders ?? 0}
                  icon="check"
                />
              </View>
            </View>

            <View className="px-4 mb-3">
              <SearchBar value={search} onChangeText={setSearch} placeholder="Buscar órdenes..." />
            </View>

            <View className="flex-row gap-2 px-4 mb-3">
              {FILTER_CHIPS.map((chip) => (
                <Pressable
                  key={chip.value}
                  onPress={() => setActiveFilter(chip.value)}
                  className={`px-3 py-1.5 rounded-full ${
                    activeFilter === chip.value
                      ? 'bg-primary-600'
                      : 'bg-gray-200'
                  }`}
                >
                  <ListItem
                    title={chip.label}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          ordersLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin órdenes"
              description="No se encontraron órdenes"
            />
          )
        }
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerClassName="pb-6"
      />
    </View>
  );
};

export default Orders;
