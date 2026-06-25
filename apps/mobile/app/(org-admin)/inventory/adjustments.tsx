import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function AdjustmentsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-inventory-adjustments'],
    queryFn: () => OrgInventoryService.listAdjustments({ pageSize: 100 }),
  });

  const adjustments = data ?? [];

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
        adjustments.length === 0
          ? { icon: 'sliders', title: 'Sin ajustes', message: 'No hay ajustes de stock.' }
          : undefined
      }
    >
      {adjustments.map((a) => (
        <OrgListItem
          key={a.id}
          title={`#${a.adjustment_number}`}
          subtitle={`${a.store_name} • ${a.reason}`}
          description={`${a.total_items} items • ${a.total_quantity} unidades`}
          leftIcon={a.type === 'INCREASE' ? 'trending-up' : 'trending-down'}
          leftIconColor={a.type === 'INCREASE' ? colorScales.green[500] : colorScales.red[500]}
          rightBadge={
            a.status === 'APPROVED'
              ? { label: 'Aprobado', variant: 'success' }
              : a.status === 'PENDING'
              ? { label: 'Pendiente', variant: 'warning' }
              : a.status === 'REJECTED'
              ? { label: 'Rechazado', variant: 'error' }
              : { label: a.status, variant: 'muted' }
          }
          rightMeta={new Date(a.created_at).toLocaleDateString()}
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
