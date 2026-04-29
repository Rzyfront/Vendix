import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal as RNModal, StyleSheet } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AccountingService } from '@/features/store/services/accounting.service';
import type { Payable } from '@/features/store/types';
import { PAYABLE_STATE_LABELS, PAYABLE_STATE_VARIANTS } from '@/features/store/types';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { spacing, borderRadius, colorScales, typography, colors } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';
import { formatDate } from '@/shared/utils/date';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

type FilterValue = 'all' | 'pending' | 'partial' | 'paid' | 'overdue';

const FILTER_CHIPS: { label: string; value: FilterValue }[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Pendientes', value: 'pending' },
  { label: 'Parciales', value: 'partial' },
  { label: 'Pagadas', value: 'paid' },
  { label: 'Vencidas', value: 'overdue' },
];

const PayableCard = ({ item, onPressPay }: { item: Payable; onPressPay: () => void }) => (
  <Card style={styles.payCardMargin}>
    <View style={styles.payHeader}>
      <View style={styles.flex1}>
        <Text style={styles.paySupplier}>{item.supplier_name}</Text>
        {item.reference && (
          <Text style={styles.payReference}>Ref: {item.reference}</Text>
        )}
      </View>
      <Badge
        label={PAYABLE_STATE_LABELS[item.state]}
        variant={PAYABLE_STATE_VARIANTS[item.state]}
        size="sm"
      />
    </View>
    <View style={styles.payDetails}>
      {item.due_date && (
        <Text style={styles.payDueDate}>Vence: {formatDate(item.due_date)}</Text>
      )}
      <Text style={styles.payAmounts}>
        Total: {formatCurrency(item.amount)} · Pagado: {formatCurrency(item.paid_amount)}
      </Text>
    </View>
    <View style={styles.payFooter}>
      <Text style={styles.payBalance}>{formatCurrency(item.balance)}</Text>
      {item.state !== 'paid' && (
        <Pressable onPress={onPressPay} style={styles.payActionButton}>
          <Text style={styles.payActionText}>Pagar</Text>
        </Pressable>
      )}
    </View>
  </Card>
);

export default function PayablesScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all');
  const [payTarget, setPayTarget] = useState<Payable | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('bank');

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['payables', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      AccountingService.getPayables({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        state: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
    initialPageParam: 1,
  });

  const payables = data?.pages.flatMap((p) => p.data) ?? [];

  const payMutation = useMutation({
    mutationFn: (params: { id: string; amount: number; payment_method: string }) =>
      AccountingService.payPayable(params.id, { amount: params.amount, payment_method: params.payment_method }),
    onSuccess: () => {
      toastSuccess('Pago registrado');
      queryClient.invalidateQueries({ queryKey: ['payables'] });
      setPayTarget(null);
      setPayAmount('');
    },
    onError: () => toastError('Error al registrar pago'),
  });

  const handlePay = () => {
    if (!payTarget || !payAmount) return;
    const amount = parseFloat(payAmount);
    if (amount <= 0 || amount > payTarget.balance) return;
    payMutation.mutate({ id: payTarget.id, amount, payment_method: payMethod });
  };

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const openPayModal = (item: Payable) => {
    setPayTarget(item);
    setPayAmount(String(item.balance));
    setPayMethod('bank');
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={payables}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PayableCard item={item} onPressPay={() => openPayModal(item)} />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.statsGrid}>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Total"
                  value={payables.length}
                  icon={<Icon name="store" size={16} color={colorScales.blue[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Pendiente"
                  value={formatCurrency(payables.reduce((s, r) => s + (r.state === 'pending' ? r.balance : 0), 0))}
                  icon={<Icon name="clock" size={16} color={colorScales.amber[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Vencido"
                  value={formatCurrency(payables.reduce((s, r) => s + (r.state === 'overdue' ? r.balance : 0), 0))}
                  icon={<Icon name="alert-triangle" size={16} color={colorScales.red[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Pagado"
                  value={formatCurrency(payables.reduce((s, r) => s + r.paid_amount, 0))}
                  icon={<Icon name="check-circle" size={16} color={colorScales.green[600]} />}
                />
              </View>
            </View>

            <View style={styles.searchWrap}>
              <SearchBar value={search} onSubmit={(text) => setSearch(text)} placeholder="Buscar obligaciones..." />
            </View>

            <View style={styles.filterRow}>
              {FILTER_CHIPS.map((chip) => (
                <Pressable
                  key={chip.value}
                  onPress={() => setActiveFilter(chip.value)}
                  style={[styles.chip, activeFilter === chip.value ? styles.chipActive : styles.chipInactive]}
                >
                  <Text style={[styles.chipText, activeFilter === chip.value ? styles.chipTextActive : styles.chipTextInactive]}>
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? <Spinner /> : <EmptyState title="Sin cuentas por pagar" description="No se encontraron payables" />
        }
        ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />

      <RNModal visible={!!payTarget} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPayTarget(null)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Registrar Pago</Text>
            <Pressable onPress={() => setPayTarget(null)} hitSlop={8}>
              <Text style={styles.modalClose}>×</Text>
            </Pressable>
          </View>
          <View style={styles.modalBody}>
            {payTarget && (
              <View style={styles.modalBodyContent}>
                <Card style={styles.payInfoCard}>
                  <Text style={styles.payInfoSupplier}>{payTarget.supplier_name}</Text>
                  <Text style={styles.payInfoBalance}>Saldo: {formatCurrency(payTarget.balance)}</Text>
                </Card>
                <Input label="Monto" value={payAmount} onChangeText={setPayAmount} placeholder="0" keyboardType="decimal-pad" />
                <Text style={styles.selectLabel}>Método de Pago</Text>
                <View style={styles.chipRow}>
                  {[
                    { value: 'cash', label: 'Efectivo' },
                    { value: 'bank', label: 'Transferencia' },
                    { value: 'card', label: 'Tarjeta' },
                  ].map((method) => (
                    <Pressable
                      key={method.value}
                      onPress={() => setPayMethod(method.value)}
                      style={[styles.chip, payMethod === method.value ? styles.chipActive : styles.chipInactive]}
                    >
                      <Text style={[styles.chipText, payMethod === method.value ? styles.chipTextActive : styles.chipTextInactive]}>
                        {method.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>
          <View style={styles.modalFooter}>
            <Button title="Registrar Pago" loading={payMutation.isPending} onPress={handlePay} fullWidth />
          </View>
        </View>
      </RNModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  flex1: { flex: 1 },
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
  chipText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as never,
  },
  chipTextActive: {
    color: '#fff',
  },
  chipTextInactive: {
    color: colorScales.gray[700],
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  payCardMargin: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    padding: spacing[4],
  },
  payHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  paySupplier: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
  },
  payReference: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  payDetails: {
    marginBottom: spacing[2],
  },
  payDueDate: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  payAmounts: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  payFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    paddingTop: spacing[3],
    marginTop: spacing[1],
  },
  payBalance: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700' as never,
    color: colorScales.gray[900],
  },
  payActionButton: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.blue[600],
    borderRadius: borderRadius.full,
  },
  payActionText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as never,
    color: '#fff',
  },
  listContent: {
    paddingBottom: spacing[6],
  },
  modalRoot: {
    flex: 1,
    backgroundColor: colors.card,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  modalTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
  },
  modalClose: {
    fontSize: typography.fontSize['2xl'],
    color: colorScales.gray[400],
  },
  modalBody: {
    flex: 1,
  },
  modalBodyContent: {
    padding: spacing[4],
    gap: spacing[3],
  },
  modalFooter: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  payInfoCard: {
    padding: spacing[3],
  },
  payInfoSupplier: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
  },
  payInfoBalance: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[1],
  },
  selectLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.secondary,
    marginBottom: spacing[1.5],
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});
