import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function SerialNumbersScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-inventory-serial-numbers'],
    queryFn: () => OrgInventoryService.listSerialNumbers({ pageSize: 100 }),
  });

  const serials = data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <OrgPageContainer
      loading={isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      empty={
        serials.length === 0
          ? { icon: 'barcode', title: 'Sin series', message: 'No hay números de serie registrados.' }
          : undefined
      }
    >
      {serials.map((s) => (
        <OrgListItem
          key={s.id}
          title={s.product_name}
          subtitle={`Serie: ${s.serial}`}
          description={s.store_name}
          leftIcon="barcode"
          rightBadge={
            s.status === 'AVAILABLE'
              ? { label: 'Disponible', variant: 'success' }
              : s.status === 'SOLD'
              ? { label: 'Vendido', variant: 'info' }
              : s.status === 'RESERVED'
              ? { label: 'Reservado', variant: 'warning' }
              : s.status === 'DEFECTIVE'
              ? { label: 'Defectuoso', variant: 'error' }
              : { label: s.status, variant: 'muted' }
          }
          rightMeta={new Date(s.created_at).toLocaleDateString()}
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
