import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgAccountingService } from '@/features/org/services/org-accounting.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function FiscalPeriodsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-accounting-periods'],
    queryFn: () => OrgAccountingService.listFiscalPeriods({ pageSize: 50 }),
  });

  const periods = data ?? [];

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
        periods.length === 0
          ? { icon: 'calendar-clock', title: 'Sin periodos', message: 'Crea el primer periodo fiscal.' }
          : undefined
      }
    >
      {periods.map((p) => (
        <OrgListItem
          key={p.id}
          title={p.name}
          subtitle={`${new Date(p.start_date).toLocaleDateString()} – ${new Date(p.end_date).toLocaleDateString()}`}
          leftIcon="calendar-clock"
          rightBadge={
            p.status === 'OPEN'
              ? { label: 'Abierto', variant: 'success' }
              : p.status === 'CLOSED'
              ? { label: 'Cerrado', variant: 'muted' }
              : { label: 'Bloqueado', variant: 'warning' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
