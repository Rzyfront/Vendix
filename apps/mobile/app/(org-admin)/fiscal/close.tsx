import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgFiscalService } from '@/features/org/services/org-fiscal.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function FiscalCloseScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-fiscal-closes'],
    queryFn: () => OrgFiscalService.listCloses({ pageSize: 50 }),
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
          ? { icon: 'lock', title: 'Sin cierres fiscales', message: 'No hay cierres fiscales registrados.' }
          : undefined
      }
    >
      {list.map((c) => (
        <OrgListItem
          key={c.id}
          title={`${c.period} (${c.year})`}
          subtitle={c.notes}
          description={`Inicio: ${new Date(c.started_at).toLocaleDateString()}${c.closed_at ? ` • Cierre: ${new Date(c.closed_at).toLocaleDateString()}` : ''}`}
          leftIcon="lock"
          rightBadge={
            c.status === 'CLOSED'
              ? { label: 'Cerrado', variant: 'success' }
              : c.status === 'IN_PROGRESS'
              ? { label: 'En progreso', variant: 'warning' }
              : { label: 'Abierto', variant: 'info' }
          }
          rightValue={c.summary?.net_income ? formatCurrency(c.summary.net_income.amount) : undefined}
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
