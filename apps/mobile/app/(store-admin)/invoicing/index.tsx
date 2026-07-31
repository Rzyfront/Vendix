import { useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { InvoiceService } from '@/features/store/services/invoice.service';
import { getNextPageParam } from '@/core/api/pagination';
import {
  Invoice,
  InvoiceStatus,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_VARIANT,
  INVOICE_TYPE_LABELS,
} from '@/features/store/types/invoice.types';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
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

type FilterChip = { label: string; value: InvoiceStatus | 'all' };

const FILTER_CHIPS: FilterChip[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Borrador', value: 'draft' },
  { label: 'Validada', value: 'validated' },
  { label: 'Enviada', value: 'sent' },
  { label: 'Aceptada', value: 'accepted' },
  { label: 'Rechazada', value: 'rejected' },
];

const InvoiceCard = ({ invoice, onPress }: { invoice: Invoice; onPress: () => void }) => (
  <Pressable onPress={onPress}>
    <Card style={styles.cardMargin}>
      <View style={styles.cardHeader}>
        <View style={styles.flex1}>
          <ListItem title={invoice.invoice_number} />
          <ListItem
            title={invoice.customer_name ?? 'Sin cliente'}
          />
        </View>
        <Badge
          label={INVOICE_STATUS_LABELS[invoice.status]}
          variant={INVOICE_STATUS_VARIANT[invoice.status]}
          size="sm"
        />
      </View>
      <View style={styles.cardFooter}>
        <View style={styles.cardFooterLeft}>
          <ListItem title={INVOICE_TYPE_LABELS[invoice.invoice_type]} />
          <ListItem title={formatRelative(invoice.created_at)} />
        </View>
        <ListItem
          title={formatCurrency(invoice.total_amount)}
        />
      </View>
    </Card>
  </Pressable>
);

export default function InvoicesList() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<InvoiceStatus | 'all'>('all');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['invoice-stats'],
    queryFn: () => InvoiceService.stats(),
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: invoicesLoading,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['invoices', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      InvoiceService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        status: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const invoices = data?.pages.flatMap((p) => p.data) ?? [];

  const handlePress = (id: string) => {
    router.push(`/(store-admin)/invoicing/${id}`);
  };

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: Invoice }) => (
      <InvoiceCard invoice={item} onPress={() => handlePress(item.id)} />
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
        data={invoices}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <StatsGrid
              style={styles.statsWrap}
              items={[
                {
                  label: 'Total Facturado',
                  value: formatCurrency(stats?.totalAmount ?? 0),
                  icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                },
                {
                  label: 'Pendientes',
                  value: stats?.pending ?? 0,
                  icon: <Icon name="clock" size={14} color={colorScales.amber[600]} />,
                },
              ]}
            />

            <View style={styles.searchWrap}>
              <SearchBar value={search} onChangeText={setSearch} placeholder="Buscar facturas..." />
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
                  <ListItem title={chip.label} />
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          invoicesLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin facturas"
              description="No se encontraron facturas"
            />
          )
        }
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  cardFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  statsWrap: {
    paddingHorizontal: spacing[4],
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
