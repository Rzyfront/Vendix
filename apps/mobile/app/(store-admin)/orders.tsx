import { useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
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
import { spacing, borderRadius, colorScales, colors } from '@/shared/theme';

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

function getChannelIcon(channel: string): string {
  switch (channel) {
    case 'pos': return 'shopping-bag';
    case 'ecommerce': return 'shopping-cart';
    case 'whatsapp': return 'message-circle';
    case 'marketplace': return 'store';
    default: return 'circle-dot';
  }
}

function getChannelColor(channel: string): string {
  switch (channel) {
    case 'pos': return colorScales.blue[500];
    case 'ecommerce': return colors.primary;
    case 'whatsapp': return colorScales.green[500];
    case 'marketplace': return colorScales.amber[500];
    default: return colorScales.gray[400];
  }
}

const OrderCard = ({ order, onPress }: { order: Order; onPress: () => void }) => {
  const badgeVariant =
    STATE_VARIANT_MAP[ORDER_STATE_COLORS[order.state]] ?? 'default';

  return (
    <Pressable onPress={onPress}>
      <Card style={styles.cardMargin}>
        <View style={styles.orderCardHeader}>
          <View style={styles.flex1}>
            <View style={styles.orderCardTitleRow}>
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

        <View style={styles.orderCardFooter}>
          <View style={styles.orderCardFooterLeft}>
            {order.channel && (
              <Icon
                name={getChannelIcon(order.channel)}
                size={14}
                color={getChannelColor(order.channel)}
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
    <View style={styles.container}>
      <FlatList
        data={orders}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <View style={styles.statsGrid}>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Total Órdenes"
                  value={stats?.total_orders ?? 0}
                  icon="clipboard-list"
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Ingresos"
                  value={formatCurrency(stats?.total_revenue ?? 0)}
                  icon="dollar-sign"
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Pendientes"
                  value={stats?.pending_orders ?? 0}
                  icon="clock"
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Completadas"
                  value={stats?.completed_orders ?? 0}
                  icon="check"
                />
              </View>
            </View>

            <View style={styles.searchWrap}>
              <SearchBar value={search} onSubmit={(text) => setSearch(text)} placeholder="Buscar órdenes..." />
            </View>

            <View style={styles.filterRow}>
              {FILTER_CHIPS.map((chip) => (
                <Pressable
                  key={chip.value}
                  onPress={() => setActiveFilter(chip.value)}
                  style={[
                    styles.chip,
                    activeFilter === chip.value ? styles.chipActive : styles.chipInactive,
                  ]}
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
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  flex1: {
    flex: 1,
  },
  cardMargin: {
    marginBottom: spacing[3],
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  orderCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[1],
  },
  orderCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  orderCardFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    padding: spacing[4],
  },
  statsItem: {
    width: '48%',
  },
  searchWrap: {
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipInactive: {
    backgroundColor: colorScales.gray[200],
  },
  listContent: {
    paddingBottom: spacing[6],
  },
});

export default Orders;
