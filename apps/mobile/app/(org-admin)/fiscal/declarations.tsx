import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgFiscalService } from '@/features/org/services/org-fiscal.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function DeclarationsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-fiscal-declarations'],
    queryFn: () => OrgFiscalService.listDeclarations({ pageSize: 100 }),
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
          ? { icon: 'file-text', title: 'Sin declaraciones', message: 'No hay declaraciones presentadas.' }
          : undefined
      }
    >
      {list.map((d) => (
        <OrgListItem
          key={d.id}
          title={d.obligation_name}
          subtitle={`${d.period} • ${d.form_number ?? ''}`}
          description={d.submitted_at ? `Presentada: ${new Date(d.submitted_at).toLocaleDateString()}` : undefined}
          leftIcon="file-text"
          rightValue={d.amount ? formatCurrency(d.amount.amount) : undefined}
          rightBadge={
            d.status === 'ACCEPTED'
              ? { label: 'Aceptada', variant: 'success' }
              : d.status === 'SUBMITTED'
              ? { label: 'Enviada', variant: 'info' }
              : d.status === 'REJECTED'
              ? { label: 'Rechazada', variant: 'error' }
              : { label: 'Borrador', variant: 'warning' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
