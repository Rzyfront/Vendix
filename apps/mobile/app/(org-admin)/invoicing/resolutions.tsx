import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInvoicingService } from '@/features/org/services/org-invoicing.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function ResolutionsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-invoicing-resolutions'],
    queryFn: () => OrgInvoicingService.listResolutions({ pageSize: 100 }),
  });

  const resolutions = data ?? [];

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
        resolutions.length === 0
          ? { icon: 'hash', title: 'Sin resoluciones', message: 'No hay resoluciones de facturación.' }
          : undefined
      }
    >
      {resolutions.map((r) => (
        <OrgListItem
          key={r.id}
          title={r.resolution_number}
          subtitle={`Prefijo: ${r.prefix}`}
          description={`Del ${r.from_number} al ${r.to_number} (actual: ${r.current_number})`}
          leftIcon="hash"
          rightBadge={
            r.status === 'ACTIVE'
              ? { label: 'Activa', variant: 'success' }
              : r.status === 'EXHAUSTED'
              ? { label: 'Agotada', variant: 'warning' }
              : r.status === 'EXPIRED'
              ? { label: 'Vencida', variant: 'error' }
              : { label: 'Inactiva', variant: 'muted' }
          }
          rightMeta={r.end_date ? new Date(r.end_date).toLocaleDateString() : undefined}
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
