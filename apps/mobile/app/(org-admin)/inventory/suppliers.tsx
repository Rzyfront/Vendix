import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function SuppliersScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-inventory-suppliers'],
    queryFn: () => OrgInventoryService.listSuppliers({ pageSize: 100 }),
  });

  const suppliers = data ?? [];

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
        suppliers.length === 0
          ? { icon: 'factory', title: 'Sin proveedores', message: 'Crea tu primer proveedor.' }
          : undefined
      }
    >
      {suppliers.map((s) => (
        <OrgListItem
          key={s.id}
          title={s.name}
          subtitle={[s.tax_id, s.email].filter(Boolean).join(' • ')}
          description={s.city ?? s.contact_name}
          leftIcon="factory"
          rightBadge={
            s.is_active
              ? { label: 'Activo', variant: 'success' }
              : { label: 'Inactivo', variant: 'muted' }
          }
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
