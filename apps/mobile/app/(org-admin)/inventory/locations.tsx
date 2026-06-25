import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function LocationsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-inventory-locations'],
    queryFn: () => OrgInventoryService.listLocations({ pageSize: 100 }),
  });

  const locations = data ?? [];

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
        locations.length === 0
          ? { icon: 'map', title: 'Sin ubicaciones', message: 'Crea la primera ubicación de inventario.' }
          : undefined
      }
    >
      {locations.map((l) => (
        <OrgListItem
          key={l.id}
          title={l.name}
          subtitle={l.code}
          description={[l.city, l.type].filter(Boolean).join(' • ')}
          leftIcon={
            l.type === 'WAREHOUSE' ? 'warehouse' :
            l.type === 'CENTRAL' ? 'building' :
            l.type === 'TRANSIT' ? 'truck' :
            'store'
          }
          leftIconColor={
            l.is_central_warehouse ? colors.primary :
            l.is_active ? colorScales.blue[500] :
            colorScales.gray[400]
          }
          rightBadge={
            l.is_central_warehouse
              ? { label: 'Central', variant: 'primary' }
              : l.is_active
              ? { label: 'Activa', variant: 'success' }
              : { label: 'Inactiva', variant: 'muted' }
          }
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
