import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgFiscalService } from '@/features/org/services/org-fiscal.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function FiscalRulesScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-fiscal-rules'],
    queryFn: () => OrgFiscalService.listRules({ pageSize: 100 }),
  });

  const list = data ?? [];

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
        list.length === 0
          ? { icon: 'shield', title: 'Sin reglas', message: 'No hay reglas fiscales configuradas.' }
          : undefined
      }
    >
      {list.map((r) => (
        <OrgListItem
          key={r.id}
          title={r.name}
          subtitle={`${r.code} • ${r.type}`}
          description={r.description}
          leftIcon="shield"
          rightValue={r.rate != null ? `${r.rate}%` : undefined}
          rightBadge={
            r.is_active
              ? { label: 'Activa', variant: 'success' }
              : { label: 'Inactiva', variant: 'muted' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
