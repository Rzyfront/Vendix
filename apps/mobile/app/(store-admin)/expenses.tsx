import { useState, useCallback } from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  Pressable,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExpenseService } from '@/features/store/services/expense.service';
import { getNextPageParam } from '@/core/api/pagination';
import type {
  Expense,
  ExpenseCategory,
  CreateExpenseDto,
} from '@/features/store/types';

type ExpenseState = Expense['state'];

import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ListItem } from '@/shared/components/list-item/list-item';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Modal } from '@/shared/components/modal/modal';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { formatDate } from '@/shared/utils/date';
import { spacing, borderRadius, typography, colorScales, colors, shadows } from '@/shared/theme';

const STATE_VARIANT_MAP: Record<ExpenseState, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  pending: 'warning',
  approved: 'success',
  paid: 'info',
  rejected: 'error',
  cancelled: 'default',
  refunded: 'default',
};

const STATE_LABELS: Record<ExpenseState, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  paid: 'Pagado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
};

type FilterChip = { label: string; value: ExpenseState | 'all' };

const FILTER_CHIPS: FilterChip[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Pendientes', value: 'pending' },
  { label: 'Aprobados', value: 'approved' },
  { label: 'Pagadas', value: 'paid' },
  { label: 'Rechazadas', value: 'rejected' },
];

const ExpenseCard = ({ expense, onPress }: { expense: Expense; onPress: () => void }) => (
  <Pressable onPress={onPress}>
    <Card style={styles.cardMargin}>
      <View style={styles.expenseCardHeader}>
        <View style={styles.flex1}>
          <Text style={styles.expenseTitle}>{expense.description}</Text>
          <Text style={styles.expenseSubtitle}>
            {expense.category_name || 'Sin categoría'}
          </Text>
        </View>
        <Badge
          label={STATE_LABELS[expense.state]}
          variant={STATE_VARIANT_MAP[expense.state]}
          size="sm"
        />
      </View>
      <View style={styles.expenseCardFooter}>
        <Text style={styles.expenseDate}>{formatDate(expense.date)}</Text>
        <Text style={styles.expenseAmount}>{formatCurrency(expense.amount)}</Text>
      </View>
    </Card>
  </Pressable>
);

export default function ExpensesScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ExpenseState | 'all'>('all');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [categoriesSheetVisible, setCategoriesSheetVisible] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['expense-stats'],
    queryFn: () => ExpenseService.getStats(),
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
    queryKey: ['expenses', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      ExpenseService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        state: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const expenses = data?.pages.flatMap((p) => p.data) ?? [];

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => ExpenseService.getCategories(),
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateExpenseDto) => ExpenseService.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-stats'] });
      toastSuccess('Gasto creado exitosamente');
      setCreateModalVisible(false);
      resetForm();
    },
    onError: () => toastError('Error al crear el gasto'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateExpenseDto> }) =>
      ExpenseService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-stats'] });
      toastSuccess('Gasto actualizado');
      setEditingExpense(null);
      resetForm();
    },
    onError: () => toastError('Error al actualizar el gasto'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => ExpenseService.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      toastSuccess('Categoría eliminada');
    },
    onError: () => toastError('Error al eliminar la categoría'),
  });

  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formCategoryId, setFormCategoryId] = useState<string | undefined>();
  const [formNotes, setFormNotes] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [newCategoryName, setNewCategoryName] = useState('');

  const resetForm = () => {
    setFormDescription('');
    setFormAmount('');
    setFormDate(new Date().toISOString().split('T')[0]);
    setFormCategoryId(undefined);
    setFormNotes('');
    setFormErrors({});
  };

  const openCreate = () => {
    resetForm();
    setEditingExpense(null);
    setCreateModalVisible(true);
  };

  const openEdit = (expense: Expense) => {
    setFormDescription(expense.description);
    setFormAmount(String(expense.amount));
    setFormDate(expense.date.split('T')[0]);
    setFormCategoryId(expense.category_id);
    setFormNotes(expense.notes || '');
    setFormErrors({});
    setEditingExpense(expense);
    setCreateModalVisible(true);
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formDescription.trim()) errors.description = 'La descripción es requerida';
    if (!formAmount.trim() || isNaN(Number(formAmount)) || Number(formAmount) <= 0)
      errors.amount = 'Ingresa un monto válido';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const dto: CreateExpenseDto = {
      description: formDescription.trim(),
      amount: Number(formAmount),
      date: formDate,
      category_id: formCategoryId,
      notes: formNotes.trim() || undefined,
    };

    if (editingExpense) {
      updateMutation.mutate({ id: editingExpense.id, data: dto });
    } else {
      createMutation.mutate(dto);
    }
  };

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    createCategoryMutation.mutate({ name: newCategoryName.trim() });
  };

  const createCategoryMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      ExpenseService.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      toastSuccess('Categoría creada');
      setNewCategoryName('');
    },
    onError: () => toastError('Error al crear la categoría'),
  });

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const renderItem = useCallback(
    ({ item }: { item: Expense }) => (
      <ExpenseCard expense={item} onPress={() => openEdit(item)} />
    ),
    [openEdit],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return <Spinner />;
  }, [isFetchingNextPage]);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <View style={styles.container}>
      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <StatsGrid
              style={styles.statsWrap}
              items={[
                {
                  label: 'Total Gastos',
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

            <View style={styles.searchRow}>
              <View style={styles.searchFlex}>
                <SearchBar
                  value={search}
                  onChangeText={setSearch}
                  onClear={() => setSearch('')}
                  placeholder="Buscar gastos..."
                />
              </View>
              <Pressable style={styles.categoryButton} onPress={() => setCategoriesSheetVisible(true)}>
                <Icon name="tag" size={20} color={colorScales.gray[600]} />
              </Pressable>
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
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin gastos"
              description="No se encontraron gastos"
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

      <Pressable style={styles.fab} onPress={openCreate}>
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>

      <Modal
        visible={createModalVisible}
        onClose={() => {
          setCreateModalVisible(false);
          setEditingExpense(null);
          resetForm();
        }}
        title={editingExpense ? 'Editar Gasto' : 'Nuevo Gasto'}
      >
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.formContent}>
            <Input
              label="Descripción *"
              value={formDescription}
              onChangeText={setFormDescription}
              error={formErrors.description}
              placeholder="Descripción del gasto"
            />

            <Input
              label="Monto *"
              value={formAmount}
              onChangeText={setFormAmount}
              error={formErrors.amount}
              placeholder="0"
              keyboardType="decimal-pad"
            />

            <Input
              label="Fecha"
              value={formDate}
              onChangeText={setFormDate}
              placeholder="YYYY-MM-DD"
            />

            {categories.length > 0 && (
              <View style={styles.sectionGap}>
                <Text style={styles.sectionLabel}>Categoría</Text>
                <View style={styles.wrapRow}>
                  <Pressable onPress={() => setFormCategoryId(undefined)}>
                    <Badge
                      label="Sin categoría"
                      variant={formCategoryId === undefined ? 'success' : 'default'}
                      size="md"
                    />
                  </Pressable>
                  {categories.map((cat: ExpenseCategory) => (
                    <Pressable key={cat.id} onPress={() => setFormCategoryId(cat.id)}>
                      <Badge
                        label={cat.name}
                        variant={formCategoryId === cat.id ? 'success' : 'default'}
                        size="md"
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <Input
              label="Notas"
              value={formNotes}
              onChangeText={setFormNotes}
              placeholder="Notas opcionales"
              multiline
            />
          </View>
        </ScrollView>

        <View style={styles.modalFooter}>
          <Button
            title={editingExpense ? 'Guardar Cambios' : 'Crear Gasto'}
            onPress={handleSubmit}
            loading={isSubmitting}
            fullWidth
          />
        </View>
      </Modal>

      <BottomSheet
        visible={categoriesSheetVisible}
        onClose={() => setCategoriesSheetVisible(false)}
        snapPoint="partial"
      >
        <View style={styles.categoriesSheetContent}>
          <Text style={styles.sheetTitle}>Categorías</Text>

          <View style={styles.addCategoryRow}>
            <TextInput
              style={styles.categoryInput}
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              placeholder="Nueva categoría"
              placeholderTextColor={colorScales.gray[400]}
            />
            <Button
              title="Agregar"
              onPress={handleAddCategory}
              loading={createCategoryMutation.isPending}
              size="sm"
            />
          </View>

          <View style={styles.categoryList}>
            {categories.length === 0 ? (
              <Text style={styles.emptyCategories}>No hay categorías</Text>
            ) : (
              categories.map((cat: ExpenseCategory) => (
                <View key={cat.id} style={styles.categoryItem}>
                  <Text style={styles.categoryName}>{cat.name}</Text>
                  <Pressable
                    onPress={() => deleteCategoryMutation.mutate(cat.id)}
                    hitSlop={8}
                  >
                    <Icon name="trash-2" size={18} color={colorScales.red[500]} />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </View>
      </BottomSheet>
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
  expenseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  expenseTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as any,
    color: colorScales.gray[900],
  },
  expenseSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  expenseCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  expenseDate: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  expenseAmount: {
    fontSize: typography.fontSize.base,
    fontWeight: '700' as any,
    color: colorScales.gray[900],
  },
  statsWrap: {
    paddingHorizontal: spacing[4],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
    gap: spacing[2],
  },
  searchFlex: {
    flex: 1,
  },
  categoryButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.lg,
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
    ...shadows.md,
  },
  formContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  sectionGap: {
    gap: spacing[2],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  wrapRow: {
    flexDirection: 'row',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  modalFooter: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  categoriesSheetContent: {
    paddingHorizontal: spacing[4],
    gap: spacing[4],
  },
  sheetTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700' as any,
    color: colorScales.gray[900],
  },
  addCategoryRow: {
    flexDirection: 'row',
    gap: spacing[2],
    alignItems: 'center',
  },
  categoryInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.lg,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
  },
  categoryList: {
    gap: spacing[2],
  },
  emptyCategories: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[400],
    textAlign: 'center',
    paddingVertical: spacing[4],
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
  },
  categoryName: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },
});
