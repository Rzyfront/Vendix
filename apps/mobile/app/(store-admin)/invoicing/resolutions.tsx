import { useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InvoiceService } from '@/features/store/services/invoice.service';
import type { Resolution } from '@/features/store/types/invoice.types';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ListItem } from '@/shared/components/list-item/list-item';
import { Modal } from '@/shared/components/modal/modal';
import { Input } from '@/shared/components/input/input';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatDate } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales } from '@/shared/theme';

export default function ResolutionsScreen() {
  const queryClient = useQueryClient();
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [startNumber, setStartNumber] = useState('');
  const [endNumber, setEndNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const {
    data: resolutions = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['resolutions'],
    queryFn: () => InvoiceService.getResolutions(),
  });

  const handleCreate = async () => {
    setActionLoading(true);
    try {
      await InvoiceService.createResolution({
        prefix,
        start_number: Number(startNumber),
        end_number: Number(endNumber),
        start_date: startDate,
        end_date: endDate,
      });
      await queryClient.invalidateQueries({ queryKey: ['resolutions'] });
      toastSuccess('Resolución creada exitosamente');
      setCreateModalVisible(false);
      setPrefix('');
      setStartNumber('');
      setEndNumber('');
      setStartDate('');
      setEndDate('');
    } catch (e: any) {
      toastError(e?.message ?? 'Error al crear resolución');
    } finally {
      setActionLoading(false);
    }
  };

  const renderItem = ({ item }: { item: Resolution }) => (
    <Card style={styles.cardMargin}>
      <View style={styles.cardHeader}>
        <View style={styles.flex1}>
          <ListItem title={`Prefijo: ${item.prefix}`} />
        </View>
        <Badge
          label={item.state === 'active' ? 'Activa' : 'Expirada'}
          variant={item.state === 'active' ? 'success' : 'default'}
          size="sm"
        />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.rowBetween}>
          <ListItem title="Rango" />
          <ListItem title={`${item.start_number} - ${item.end_number}`} />
        </View>
        <View style={styles.rowBetween}>
          <ListItem title="Actual" />
          <ListItem title={String(item.current_number)} />
        </View>
        <View style={styles.rowBetween}>
          <ListItem title="Inicio" />
          <ListItem title={formatDate(item.start_date)} />
        </View>
        <View style={styles.rowBetween}>
          <ListItem title="Fin" />
          <ListItem title={formatDate(item.end_date)} />
        </View>
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={resolutions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Button
              title="Nueva Resolución"
              onPress={() => setCreateModalVisible(true)}
              variant="primary"
            />
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin resoluciones"
              description="No hay resoluciones registradas"
            />
          )
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        contentContainerStyle={styles.listContent}
      />

      <Modal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        title="Nueva Resolución"
      >
        <View style={styles.modalGap}>
          <Input
            label="Prefijo"
            value={prefix}
            onChangeText={setPrefix}
            placeholder="Ej: FE"
          />
          <Input
            label="Número Inicio"
            value={startNumber}
            onChangeText={setStartNumber}
            keyboardType="numeric"
            placeholder="1"
          />
          <Input
            label="Número Fin"
            value={endNumber}
            onChangeText={setEndNumber}
            keyboardType="numeric"
            placeholder="10000"
          />
          <Input
            label="Fecha Inicio"
            value={startDate}
            onChangeText={setStartDate}
            placeholder="YYYY-MM-DD"
          />
          <Input
            label="Fecha Fin"
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD"
          />
          <Button
            title="Crear Resolución"
            onPress={handleCreate}
            loading={actionLoading}
          />
        </View>
      </Modal>
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
  cardBody: {
    gap: spacing[1],
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listHeader: {
    padding: spacing[4],
  },
  listContent: {
    paddingBottom: spacing[6],
  },
  modalGap: {
    gap: spacing[3],
  },
});
