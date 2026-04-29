import { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal as RNModal, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AccountingService } from '@/features/store/services/accounting.service';
import type { Account, ACCOUNT_TYPE_LABELS } from '@/features/store/types';
import { ACCOUNT_TYPE_LABELS as AccountTypeLabels, ACCOUNT_NATURE_LABELS } from '@/features/store/types';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { spacing, borderRadius, colorScales, typography, colors } from '@/shared/theme';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

type AccountType = Account['type'];
type AccountNature = Account['nature'];

const TYPE_OPTIONS: { label: string; value: AccountType }[] = [
  { label: 'Activo', value: 'asset' },
  { label: 'Pasivo', value: 'liability' },
  { label: 'Patrimonio', value: 'equity' },
  { label: 'Ingreso', value: 'revenue' },
  { label: 'Gasto', value: 'expense' },
];

const NATURE_OPTIONS: { label: string; value: AccountNature }[] = [
  { label: 'Débito', value: 'debit' },
  { label: 'Crédito', value: 'credit' },
];

function flattenAccounts(accounts: Account[], depth = 0): (Account & { _depth: number })[] {
  const result: (Account & { _depth: number })[] = [];
  for (const account of accounts) {
    result.push({ ...account, _depth: depth });
    if (account.children?.length) {
      result.push(...flattenAccounts(account.children, depth + 1));
    }
  }
  return result;
}

function countByType(accounts: Account[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (items: Account[]) => {
    for (const a of items) {
      counts[a.type] = (counts[a.type] || 0) + 1;
      if (a.children?.length) walk(a.children);
    }
  };
  walk(accounts);
  return counts;
}

function getTypeBadgeVariant(type: AccountType): 'default' | 'success' | 'warning' | 'error' | 'info' {
  switch (type) {
    case 'asset': return 'info';
    case 'liability': return 'warning';
    case 'equity': return 'default';
    case 'revenue': return 'success';
    case 'expense': return 'error';
    default: return 'default';
  }
}

export default function ChartOfAccountsScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);

  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<AccountType>('asset');
  const [formNature, setFormNature] = useState<AccountNature>('debit');
  const [formParentId, setFormParentId] = useState('');

  const { data: accounts = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['chart-of-accounts'],
    queryFn: () => AccountingService.getAccounts(),
  });

  const createMutation = useMutation({
    mutationFn: AccountingService.createAccount,
    onSuccess: () => {
      toastSuccess('Cuenta creada');
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      setCreateModalVisible(false);
      resetForm();
    },
    onError: () => toastError('Error al crear cuenta'),
  });

  const deleteMutation = useMutation({
    mutationFn: AccountingService.deleteAccount,
    onSuccess: () => {
      toastSuccess('Cuenta eliminada');
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      setDeleteTarget(null);
    },
    onError: () => toastError('Error al eliminar cuenta'),
  });

  const resetForm = () => {
    setFormCode('');
    setFormName('');
    setFormType('asset');
    setFormNature('debit');
    setFormParentId('');
  };

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredAccounts = useMemo(() => {
    if (!search.trim()) return accounts;
    const lower = search.toLowerCase();
    const walk = (items: Account[]): Account[] => {
      const result: Account[] = [];
      for (const a of items) {
        const matchesSelf = a.code.toLowerCase().includes(lower) || a.name.toLowerCase().includes(lower);
        const childMatches = a.children?.length ? walk(a.children) : [];
        if (matchesSelf || childMatches.length) {
          result.push({ ...a, children: childMatches.length ? childMatches : a.children });
        }
      }
      return result;
    };
    return walk(accounts);
  }, [accounts, search]);

  const flatAccounts = useMemo(() => flattenAccounts(filteredAccounts), [filteredAccounts]);

  const stats = useMemo(() => {
    const total = flattenAccounts(accounts).length;
    const active = flattenAccounts(accounts).filter((a) => a.state === 'active').length;
    const typeCounts = countByType(accounts);
    return { total, active, types: Object.keys(typeCounts).length };
  }, [accounts]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleCreate = () => {
    if (!formCode.trim() || !formName.trim()) return;
    createMutation.mutate({
      code: formCode.trim(),
      name: formName.trim(),
      type: formType,
      nature: formNature,
      parent_id: formParentId || undefined,
    });
  };

  const isExpanded = (id: string, depth: number) => {
    if (depth === 0) return true;
    return expandedIds.has(id);
  };

  const shouldShow = (item: (Account & { _depth: number }), index: number, list: (Account & { _depth: number })[]) => {
    if (item._depth === 0) return true;
    for (let i = index - 1; i >= 0; i--) {
      const parent = list[i];
      if (parent._depth < item._depth) {
        return isExpanded(parent.id, parent._depth);
      }
    }
    return true;
  };

  const visibleAccounts = useMemo(() => {
    return flatAccounts.filter((item, index) => shouldShow(item, index, flatAccounts));
  }, [flatAccounts]);

  const hasChildren = (account: Account & { _depth: number }) => {
    return filteredAccounts.some((a) => a.parent_id === account.id || a.children?.some((c) => c.id === account.id));
  };

  const renderAccount = ({ item }: { item: Account & { _depth: number } }) => {
    const showChildren = hasChildren(item);
    return (
      <Pressable
        onPress={() => showChildren && toggleExpand(item.id)}
        onLongPress={() => item.accepts_entries && setDeleteTarget(item)}
        style={[styles.accountRow, { marginLeft: item._depth * 20 }]}
      >
        <View style={styles.accountLeft}>
          {showChildren ? (
            <Icon
              name={expandedIds.has(item.id) ? 'chevron-down' : 'chevron-right'}
              size={14}
              color={colorScales.gray[400]}
            />
          ) : (
            <View style={styles.chevronSpacer} />
          )}
          <View style={styles.accountTextWrap}>
            <Text style={styles.accountCode}>{item.code}</Text>
            <Text style={styles.accountName} numberOfLines={1}>{item.name}</Text>
          </View>
        </View>
        <View style={styles.accountRight}>
          <Badge
            label={AccountTypeLabels[item.type]}
            variant={getTypeBadgeVariant(item.type)}
            size="sm"
          />
          <Badge
            label={ACCOUNT_NATURE_LABELS[item.nature]}
            variant={item.nature === 'debit' ? 'info' : 'warning'}
            size="sm"
          />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={visibleAccounts}
        keyExtractor={(item) => item.id}
        renderItem={renderAccount}
        ListHeaderComponent={
          <View>
            <View style={styles.statsGrid}>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Total Cuentas"
                  value={stats.total}
                  icon={<Icon name="list-tree" size={16} color={colorScales.blue[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Activas"
                  value={stats.active}
                  icon={<Icon name="check-circle" size={16} color={colorScales.green[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Tipos"
                  value={stats.types}
                  icon={<Icon name="layers" size={16} color={colorScales.amber[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Niveles"
                  value={Math.max(...flattenAccounts(accounts).map((a) => a._depth + 1), 0)}
                  icon={<Icon name="git-branch" size={16} color={colorScales.blue[600]} />}
                />
              </View>
            </View>

            <View style={styles.searchWrap}>
              <SearchBar value={search} onSubmit={(text) => setSearch(text)} placeholder="Buscar cuenta..." />
            </View>

            <View style={styles.actionsRow}>
              <Button
                title="Nueva Cuenta"
                leftIcon={<Icon name="plus" size={16} color="#fff" />}
                onPress={() => setCreateModalVisible(true)}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState title="Sin cuentas" description="No se encontraron cuentas" />
          )
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.listContent}
      />

      <RNModal visible={createModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCreateModalVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nueva Cuenta</Text>
            <Pressable onPress={() => setCreateModalVisible(false)} hitSlop={8}>
              <Text style={styles.modalClose}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
            <Input label="Código" value={formCode} onChangeText={setFormCode} placeholder="Ej: 1105" />
            <Input label="Nombre" value={formName} onChangeText={setFormName} placeholder="Nombre de la cuenta" />

            <Text style={styles.selectLabel}>Tipo de Cuenta</Text>
            <View style={styles.chipRow}>
              {TYPE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setFormType(opt.value)}
                  style={[styles.chip, formType === opt.value ? styles.chipActive : styles.chipInactive]}
                >
                  <Text style={[styles.chipText, formType === opt.value ? styles.chipTextActive : styles.chipTextInactive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.selectLabel}>Naturaleza</Text>
            <View style={styles.chipRow}>
              {NATURE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setFormNature(opt.value)}
                  style={[styles.chip, formNature === opt.value ? styles.chipActive : styles.chipInactive]}
                >
                  <Text style={[styles.chipText, formNature === opt.value ? styles.chipTextActive : styles.chipTextInactive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Input label="Cuenta Padre (opcional)" value={formParentId} onChangeText={setFormParentId} placeholder="ID de cuenta padre" />
          </ScrollView>
          <View style={styles.modalFooter}>
            <Button title="Crear Cuenta" loading={createMutation.isPending} onPress={handleCreate} fullWidth />
          </View>
        </View>
      </RNModal>

      <ConfirmDialog
        visible={!!deleteTarget}
        title="Eliminar Cuenta"
        message={`¿Eliminar la cuenta ${deleteTarget?.code} - ${deleteTarget?.name}?`}
        confirmLabel="Eliminar"
        destructive
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
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
  actionsRow: {
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    backgroundColor: colors.card,
  },
  accountLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing[2],
  },
  chevronSpacer: {
    width: 14,
  },
  accountTextWrap: {
    flex: 1,
  },
  accountCode: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    fontWeight: '500' as never,
  },
  accountName: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
    fontWeight: '500' as never,
  },
  accountRight: {
    flexDirection: 'row',
    gap: spacing[1],
    alignItems: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colorScales.gray[200],
    marginHorizontal: spacing[4],
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
  selectLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.secondary,
    marginBottom: spacing[1.5],
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
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
});
