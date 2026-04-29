import { useState, useCallback } from 'react';
import { View, FlatList, Pressable, RefreshControl, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services/customer.service';
import type { Customer, CustomerState, CustomerStats } from '@/features/store/types';
import { formatCurrency } from '@/shared/utils/currency';
import { formatRelative } from '@/shared/utils/date';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Avatar } from '@/shared/components/avatar/avatar';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

const STATE_FILTERS: { label: string; value?: CustomerState }[] = [
  { label: 'Todos' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
];

const customerCardStyles = StyleSheet.create({
  wrapper: {
    flex: 1,
    maxWidth: '50%',
  },
  cardInner: {
    margin: spacing[1],
    overflow: 'hidden',
  },
  avatarArea: {
    padding: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
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
  email: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing[1],
    marginTop: spacing[1],
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    paddingTop: spacing[2],
    marginTop: spacing[2],
  },
  spentLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  spentValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.green[600],
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
  },
  detailText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
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
    backgroundColor: colorScales.green[600],
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
    backgroundColor: colorScales.green[600],
    alignItems: 'center',
    justifyContent: 'center',
    ...{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  },
});

const CustomerCard = ({ customer, onPress }: { customer: Customer; onPress: () => void }) => {
  const fullName = `${customer.first_name} ${customer.last_name}`;
  const stateVariant = customer.state === 'active' ? 'success' : 'warning';

  return (
    <Pressable onPress={onPress} style={customerCardStyles.wrapper}>
      <Card style={customerCardStyles.cardInner}>
        <View style={customerCardStyles.avatarArea}>
          <Avatar name={fullName} size="lg" />
        </View>
        <View style={customerCardStyles.content}>
          <Text style={customerCardStyles.name} numberOfLines={1}>
            {fullName}
          </Text>
          <Text style={customerCardStyles.email} numberOfLines={1}>
            {customer.email}
          </Text>
          <View style={customerCardStyles.badgeRow}>
            <Badge
              label={customer.state === 'active' ? 'Activo' : 'Inactivo'}
              variant={stateVariant}
              size="sm"
            />
          </View>
          <View style={customerCardStyles.footer}>
            <Text style={customerCardStyles.spentLabel}>Total gastado</Text>
            <Text style={customerCardStyles.spentValue}>
              {formatCurrency(customer.total_spent ?? 0)}
            </Text>
          </View>
          <View style={customerCardStyles.detailRow}>
            <Icon name="phone" size={12} color={colorScales.gray[400]} />
            <Text style={customerCardStyles.detailText}>
              {customer.phone || 'Sin teléfono'}
            </Text>
          </View>
          {customer.total_orders !== undefined && (
            <View style={customerCardStyles.detailRow}>
              <Icon name="shopping-bag" size={12} color={colorScales.gray[400]} />
              <Text style={customerCardStyles.detailText}>
                {customer.total_orders} órdenes
              </Text>
            </View>
          )}
        </View>
      </Card>
    </Pressable>
  );
};

const StatsGrid = ({ stats }: { stats: CustomerStats | undefined }) => (
  <View style={statsGridStyles.container}>
    <View style={statsGridStyles.item}>
      <StatsCard label="Total Clientes" value={String(stats?.total ?? 0)} icon="users" />
    </View>
    <View style={statsGridStyles.item}>
      <StatsCard label="Activos" value={String(stats?.active ?? 0)} icon="user-check" />
    </View>
    <View style={statsGridStyles.item}>
      <StatsCard label="Nuevos Este Mes" value={String(stats?.newThisMonth ?? 0)} icon="user-plus" />
    </View>
    <View style={statsGridStyles.item}>
      <StatsCard
        label="Ingresos Totales"
        value={formatCurrency(stats?.totalRevenue ?? 0)}
        icon="dollar-sign"
      />
    </View>
  </View>
);

const FilterChips = ({
  activeFilter,
  onSelect,
}: {
  activeFilter?: CustomerState;
  onSelect: (value?: CustomerState) => void;
}) => (
  <FlatList
    horizontal
    showsHorizontalScrollIndicator={false}
    data={STATE_FILTERS}
    keyExtractor={(item) => item.label}
    renderItem={({ item }) => {
      const isActive = item.value === activeFilter;
      return (
        <Pressable
          onPress={() => onSelect(item.value)}
          style={isActive ? filterStyles.chipActive : filterStyles.chipInactive}
        >
          <Text style={isActive ? filterStyles.chipTextActive : filterStyles.chipTextInactive}>
            {item.label}
          </Text>
        </Pressable>
      );
    }}
    style={filterStyles.list}
  />
);

export default function CustomersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<CustomerState | undefined>();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['customer-stats'],
    queryFn: () => CustomerService.stats(),
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: customersLoading,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['customers', search, stateFilter],
    queryFn: ({ pageParam = 1 }) =>
      CustomerService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        state: stateFilter,
      }),
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
    initialPageParam: 1,
  });

  const customers = data?.pages.flatMap((p) => p.data) ?? [];

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
  }, []);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderCustomer = useCallback(
    ({ item }: { item: Customer }) => (
      <CustomerCard customer={item} onPress={() => router.push(`/(store-admin)/customers/${item.id}`)} />
    ),
    [router],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return <Spinner />;
  }, [isFetchingNextPage]);

  if (customersLoading && !data) {
    return (
      <View style={screenStyles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={screenStyles.root}>
      <FlatList
        data={customers}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderCustomer}
        numColumns={2}
        ListHeaderComponent={
          <View>
            <StatsGrid stats={stats} />
            <View style={{ paddingHorizontal: spacing[4], marginBottom: spacing[3] }}>
              <SearchBar
                value={search}
                onSubmit={handleSearch}
                onClear={() => handleSearch('')}
                placeholder="Buscar clientes..."
              />
            </View>
            <FilterChips
              activeFilter={stateFilter}
              onSelect={(v) => setStateFilter(v)}
            />
          </View>
        }
        ListEmptyComponent={
          customersLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin clientes"
              description="Aún no tienes clientes registrados"
              actionLabel="Crear cliente"
              onAction={() => router.push('/(store-admin)/customers/create')}
              icon="users"
            />
          )
        }
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={{ paddingBottom: spacing[24], paddingHorizontal: spacing[2] }}
      />
      <Pressable
        onPress={() => router.push('/(store-admin)/customers/create')}
        style={screenStyles.fab}
      >
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>
    </View>
  );
}
