import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function BatchesScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-inventory-batches'],
    queryFn: () => OrgInventoryService.listBatches({ pageSize: 100 }),
  });

  const batches = data ?? [];

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
        batches.length === 0
          ? { icon: 'layers', title: 'Sin lotes', message: 'No hay lotes registrados.' }
          : undefined
      }
    >
      {batches.map((b) => (
        <OrgListItem
          key={b.id}
          title={b.product_name}
          subtitle={`Lote: ${b.batch_number} • ${b.store_name ?? ''}`}
          description={`Vence: ${b.expiration_date ? new Date(b.expiration_date).toLocaleDateString() : '—'}`}
          leftIcon="layers"
          rightBadge={
            b.status === 'ACTIVE'
              ? { label: 'Activo', variant: 'success' }
              : b.status === 'EXPIRED'
              ? { label: 'Vencido', variant: 'error' }
              : b.status === 'DEPLETED'
              ? { label: 'Agotado', variant: 'muted' }
              : { label: b.status, variant: 'warning' }
          }
          rightValue={`${b.available_quantity}/${b.quantity}`}
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
