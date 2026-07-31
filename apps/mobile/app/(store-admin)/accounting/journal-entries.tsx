import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal as RNModal, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AccountingService } from '@/features/store/services/accounting.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { JournalEntry, JournalEntryLine, Account } from '@/features/store/types';
import {
  JOURNAL_ENTRY_STATE_LABELS,
  JOURNAL_ENTRY_STATE_VARIANTS,
} from '@/features/store/types';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
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

type FilterValue = 'all' | 'draft' | 'posted' | 'voided';

const FILTER_CHIPS: { label: string; value: FilterValue }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Borradores', value: 'draft' },
  { label: 'Contabilizados', value: 'posted' },
  { label: 'Anulados', value: 'voided' },
];

interface LineInput {
  account_id: string;
  account_name: string;
  debit: string;
  credit: string;
}

const JournalEntryCard = ({ entry, onPress }: { entry: JournalEntry; onPress: () => void }) => (
  <Pressable onPress={onPress}>
    <Card style={styles.jeCardMargin}>
      <View style={styles.jeHeader}>
        <View style={styles.flex1}>
          <Text style={styles.jeNumber}>{entry.entry_number}</Text>
          <Text style={styles.jeDescription} numberOfLines={1}>{entry.description}</Text>
        </View>
        <Badge
          label={JOURNAL_ENTRY_STATE_LABELS[entry.state]}
          variant={JOURNAL_ENTRY_STATE_VARIANTS[entry.state]}
          size="sm"
        />
      </View>
      <View style={styles.jeFooter}>
        <Text style={styles.jeDate}>{formatDate(entry.entry_date)}</Text>
        <Text style={styles.jeAmount}>{formatCurrency(entry.total_debit)}</Text>
      </View>
    </Card>
  </Pressable>
);

export default function JournalEntriesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all');
  const [createModalVisible, setCreateModalVisible] = useState(false);

  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formType, setFormType] = useState('manual');
  const [lines, setLines] = useState<LineInput[]>([
    { account_id: '', account_name: '', debit: '', credit: '' },
    { account_id: '', account_name: '', debit: '', credit: '' },
  ]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['journal-entries-stats'],
    queryFn: async () => {
      const [draft, posted, voided] = await Promise.all([
        AccountingService.getJournalEntries({ state: 'draft', page: 1, limit: 1 }),
        AccountingService.getJournalEntries({ state: 'posted', page: 1, limit: 1 }),
        AccountingService.getJournalEntries({ state: 'voided', page: 1, limit: 1 }),
      ]);
      return {
        total: draft.pagination.total + posted.pagination.total + voided.pagination.total,
        drafts: draft.pagination.total,
        posted: posted.pagination.total,
        voided: voided.pagination.total,
      };
    },
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['journal-entries', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      AccountingService.getJournalEntries({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        state: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const entries = data?.pages.flatMap((p) => p.data) ?? [];

  const createMutation = useMutation({
    mutationFn: AccountingService.createJournalEntry,
    onSuccess: () => {
      toastSuccess('Asiento creado');
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      setCreateModalVisible(false);
      resetForm();
    },
    onError: () => toastError('Error al crear asiento'),
  });

  const resetForm = () => {
    setFormDescription('');
    setFormDate(new Date().toISOString().split('T')[0]);
    setFormType('manual');
    setLines([
      { account_id: '', account_name: '', debit: '', credit: '' },
      { account_id: '', account_name: '', debit: '', credit: '' },
    ]);
  };

  const updateLine = (index: number, field: keyof LineInput, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addLine = () => {
    setLines((prev) => [...prev, { account_id: '', account_name: '', debit: '', credit: '' }]);
  };

  const removeLine = (index: number) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const handleCreate = () => {
    const validLines = lines
      .filter((l) => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
      .map((l) => ({
        account_id: l.account_id,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
      }));
    if (!formDescription.trim() || validLines.length < 2 || !isBalanced) return;

    createMutation.mutate({
      description: formDescription.trim(),
      entry_date: formDate,
      entry_type: formType,
      lines: validLines,
    });
  };

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  return (
    <View style={styles.container}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <JournalEntryCard entry={item} onPress={() => router.push(`/(store-admin)/accounting/${item.id}` as never)} />
        )}
        ListHeaderComponent={
          <View>
            <StatsGrid
              style={styles.statsWrap}
              items={[
                {
                  label: 'Total Asientos',
                  value: stats?.total ?? 0,
                  icon: <Icon name="book-open" size={14} color={colorScales.blue[600]} />,
                },
                {
                  label: 'Contabilizados',
                  value: stats?.posted ?? 0,
                  icon: <Icon name="check-circle" size={14} color={colorScales.green[600]} />,
                },
              ]}
            />

            <View style={styles.searchWrap}>
              <SearchBar value={search} onChangeText={setSearch} placeholder="Buscar asientos..." />
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

            <View style={styles.actionsRow}>
              <Button
                title="Nuevo Asiento"
                leftIcon={<Icon name="plus" size={16} color="#fff" />}
                onPress={() => setCreateModalVisible(true)}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? <Spinner /> : <EmptyState title="Sin asientos" description="No se encontraron asientos contables" />
        }
        ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />

      <RNModal visible={createModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCreateModalVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuevo Asiento</Text>
            <Pressable onPress={() => setCreateModalVisible(false)} hitSlop={8}>
              <Text style={styles.modalClose}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
            <Input label="Descripción" value={formDescription} onChangeText={setFormDescription} placeholder="Descripción del asiento" />
            <Input label="Fecha" value={formDate} onChangeText={setFormDate} placeholder="YYYY-MM-DD" />
            <Input label="Tipo" value={formType} onChangeText={setFormType} placeholder="manual, adjustment..." />

            <Text style={styles.sectionLabel}>Líneas del Asiento</Text>

            {lines.map((line, index) => (
              <Card key={index} style={styles.lineCard}>
                <View style={styles.lineHeader}>
                  <Text style={styles.lineIndex}>Línea {index + 1}</Text>
                  {lines.length > 2 && (
                    <Pressable onPress={() => removeLine(index)} hitSlop={8}>
                      <Icon name="trash-2" size={14} color={colorScales.red[500]} />
                    </Pressable>
                  )}
                </View>
                <Input label="Cuenta ID" value={line.account_id} onChangeText={(v) => updateLine(index, 'account_id', v)} placeholder="ID de cuenta" />
                <Input label="Débito" value={line.debit} onChangeText={(v) => updateLine(index, 'debit', v)} placeholder="0" keyboardType="decimal-pad" />
                <Input label="Crédito" value={line.credit} onChangeText={(v) => updateLine(index, 'credit', v)} placeholder="0" keyboardType="decimal-pad" />
              </Card>
            ))}

            <Pressable onPress={addLine} style={styles.addLineButton}>
              <Icon name="plus" size={16} color={colors.primary} />
              <Text style={styles.addLineText}>Agregar Línea</Text>
            </Pressable>

            <Card style={styles.balanceCard}>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Total Débito</Text>
                <Text style={styles.balanceValue}>{formatCurrency(totalDebit)}</Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Total Crédito</Text>
                <Text style={styles.balanceValue}>{formatCurrency(totalCredit)}</Text>
              </View>
              <View style={[styles.balanceRow, styles.balanceDivider]}>
                <Text style={styles.balanceLabel}>Diferencia</Text>
                <Text style={[styles.balanceValue, isBalanced ? styles.balancedOk : styles.balancedError]}>
                  {formatCurrency(Math.abs(totalDebit - totalCredit))}
                </Text>
              </View>
              <Text style={[styles.balanceStatus, isBalanced ? styles.balancedOk : styles.balancedError]}>
                {isBalanced ? '✓ Asiento balanceado' : '✗ El asiento no balancea'}
              </Text>
            </Card>
          </ScrollView>
          <View style={styles.modalFooter}>
            <Button
              title="Crear Asiento"
              loading={createMutation.isPending}
              onPress={handleCreate}
              fullWidth
              disabled={!isBalanced || !formDescription.trim()}
            />
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
  actionsRow: {
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  jeCardMargin: {
    marginBottom: spacing[3],
  },
  jeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  jeNumber: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
  },
  jeDescription: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  jeFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  jeDate: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  jeAmount: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
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
  sectionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as never,
    color: colorScales.gray[700],
    marginTop: spacing[2],
  },
  lineCard: {
    padding: spacing[3],
    gap: spacing[2],
  },
  lineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  lineIndex: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600' as never,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
  },
  addLineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderStyle: 'dashed',
  },
  addLineText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: '500' as never,
  },
  balanceCard: {
    padding: spacing[3],
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[1],
  },
  balanceDivider: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    marginTop: spacing[1],
    paddingTop: spacing[2],
  },
  balanceLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  balanceValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
  },
  balancedOk: {
    color: colorScales.green[600],
  },
  balancedError: {
    color: colorScales.red[600],
  },
  balanceStatus: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as never,
    textAlign: 'center',
    marginTop: spacing[2],
  },
});
