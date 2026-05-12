import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal as RNModal, ScrollView, StyleSheet } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AccountingService } from '@/features/store/services/accounting.service';
import type { FiscalPeriod } from '@/features/store/types';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { spacing, colorScales, typography, colors } from '@/shared/theme';
import { formatDate } from '@/shared/utils/date';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

export default function FiscalPeriodsScreen() {
  const queryClient = useQueryClient();
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [formName, setFormName] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');

  const { data: periods = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['fiscal-periods'],
    queryFn: () => AccountingService.getFiscalPeriods(),
  });

  const createMutation = useMutation({
    mutationFn: AccountingService.createFiscalPeriod,
    onSuccess: () => {
      toastSuccess('Período creado');
      queryClient.invalidateQueries({ queryKey: ['fiscal-periods'] });
      setCreateModalVisible(false);
      resetForm();
    },
    onError: () => toastError('Error al crear período'),
  });

  const resetForm = () => {
    setFormName('');
    setFormStartDate('');
    setFormEndDate('');
  };

  const handleCreate = () => {
    if (!formName.trim() || !formStartDate || !formEndDate) return;
    createMutation.mutate({
      name: formName.trim(),
      start_date: formStartDate,
      end_date: formEndDate,
    });
  };

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const renderItem = ({ item }: { item: FiscalPeriod }) => (
    <Card style={styles.cardMargin}>
      <View style={styles.periodHeader}>
        <View style={styles.periodTitleWrap}>
          <Text style={styles.periodName}>{item.name}</Text>
          <Text style={styles.periodRange}>
            {formatDate(item.start_date)} — {formatDate(item.end_date)}
          </Text>
        </View>
        <Badge
          label={item.state === 'open' ? 'Abierto' : 'Cerrado'}
          variant={item.state === 'open' ? 'success' : 'default'}
          size="sm"
        />
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={periods}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.actionsRow}>
            <Button
              title="Nuevo Período"
              leftIcon={<Icon name="plus" size={16} color="#fff" />}
              onPress={() => setCreateModalVisible(true)}
            />
          </View>
        }
        ListEmptyComponent={
          isLoading ? <Spinner /> : <EmptyState title="Sin períodos" description="No hay períodos fiscales configurados" />
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.listContent}
      />

      <RNModal visible={createModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCreateModalVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuevo Período Fiscal</Text>
            <Pressable onPress={() => setCreateModalVisible(false)} hitSlop={8}>
              <Text style={styles.modalClose}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
            <Input label="Nombre" value={formName} onChangeText={setFormName} placeholder="Ej: Año 2026" />
            <Input label="Fecha Inicio" value={formStartDate} onChangeText={setFormStartDate} placeholder="YYYY-MM-DD" />
            <Input label="Fecha Fin" value={formEndDate} onChangeText={setFormEndDate} placeholder="YYYY-MM-DD" />
          </ScrollView>
          <View style={styles.modalFooter}>
            <Button title="Crear Período" loading={createMutation.isPending} onPress={handleCreate} fullWidth />
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
  actionsRow: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
  },
  cardMargin: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    padding: spacing[4],
  },
  periodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  periodTitleWrap: {
    flex: 1,
    marginRight: spacing[3],
  },
  periodName: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
  },
  periodRange: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
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
});
