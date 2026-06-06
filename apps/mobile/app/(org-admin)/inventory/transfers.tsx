import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function TransfersScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-inventory-transfers'],
    queryFn: () => OrgInventoryService.listTransfers({ pageSize: 100 }),
  });

  const transfers = data ?? [];

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
        transfers.length === 0
          ? { icon: 'truck', title: 'Sin transferencias', message: 'No hay transferencias de stock entre tiendas.' }
          : undefined
      }
    >
      {transfers.map((t) => (
        <OrgListItem
          key={t.id}
          title={`#${t.transfer_number}`}
          subtitle={`${t.from_store_name} → ${t.to_store_name}`}
          description={`${t.total_items} items • ${t.total_quantity} unidades`}
          leftIcon="truck"
          rightBadge={
            t.status === 'COMPLETED'
              ? { label: 'Completada', variant: 'success' }
              : t.status === 'IN_TRANSIT'
              ? { label: 'En tránsito', variant: 'warning' }
              : t.status === 'CANCELLED'
              ? { label: 'Cancelada', variant: 'error' }
              : { label: t.status, variant: 'muted' }
          }
          rightMeta={t.expected_date ? new Date(t.expected_date).toLocaleDateString() : undefined}
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
