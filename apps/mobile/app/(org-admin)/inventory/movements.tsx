import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function MovementsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-inventory-movements'],
    queryFn: () => OrgInventoryService.listMovements({ pageSize: 100 }),
  });

  const movements = data ?? [];

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
        movements.length === 0
          ? { icon: 'activity', title: 'Sin movimientos', message: 'No hay movimientos de stock.' }
          : undefined
      }
    >
      {movements.map((m) => (
        <OrgListItem
          key={m.id}
          title={m.product_name}
          subtitle={`${m.store_name ?? ''} ${m.location_name ? `• ${m.location_name}` : ''}`.trim()}
          description={m.reason ?? m.source}
          leftIcon={
            m.type === 'IN' ? 'trending-up' :
            m.type === 'OUT' ? 'trending-down' :
            m.type === 'TRANSFER' ? 'arrow-left-right' :
            'sliders'
          }
          leftIconColor={
            m.type === 'IN' ? colorScales.green[500] :
            m.type === 'OUT' ? colorScales.red[500] :
            m.type === 'TRANSFER' ? colorScales.blue[500] :
            colorScales.amber[500]
          }
          rightValue={`${m.quantity}`}
          rightMeta={new Date(m.created_at).toLocaleDateString()}
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
