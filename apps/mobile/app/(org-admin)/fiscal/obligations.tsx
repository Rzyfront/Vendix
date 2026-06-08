import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgFiscalService } from '@/features/org/services/org-fiscal.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function ObligationsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-fiscal-obligations'],
    queryFn: () => OrgFiscalService.listObligations({ pageSize: 100 }),
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
          ? { icon: 'clipboard-list', title: 'Sin obligaciones', message: 'No hay obligaciones fiscales.' }
          : undefined
      }
    >
      {list.map((o) => (
        <OrgListItem
          key={o.id}
          title={o.name}
          subtitle={`${o.code} • ${o.periodicity}`}
          description={`Vence: ${new Date(o.due_date).toLocaleDateString()}`}
          leftIcon="clipboard-list"
          rightValue={o.amount ? formatCurrency(o.amount.amount) : undefined}
          rightBadge={
            o.status === 'FILED'
              ? { label: 'Presentada', variant: 'success' }
              : o.status === 'OVERDUE'
              ? { label: 'Vencida', variant: 'error' }
              : o.status === 'NOT_APPLICABLE'
              ? { label: 'N/A', variant: 'muted' }
              : { label: 'Pendiente', variant: 'warning' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
