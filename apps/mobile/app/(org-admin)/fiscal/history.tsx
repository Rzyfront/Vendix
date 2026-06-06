import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgFiscalService } from '@/features/org/services/org-fiscal.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function FiscalHistoryScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-fiscal-history'],
    queryFn: () => OrgFiscalService.listHistory({ pageSize: 100 }),
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
          ? { icon: 'history', title: 'Sin historial', message: 'No hay eventos en el historial fiscal.' }
          : undefined
      }
    >
      {list.map((h) => (
        <OrgListItem
          key={h.id}
          title={h.title}
          subtitle={h.performed_by}
          description={h.description}
          leftIcon={
            h.type === 'CLOSING' ? 'lock' :
            h.type === 'DECLARATION' ? 'file-text' :
            h.type === 'PAYMENT' ? 'dollar-sign' :
            h.type === 'AUDIT' ? 'eye' :
            'info'
          }
          rightValue={h.amount ? formatCurrency(h.amount.amount) : undefined}
          rightMeta={new Date(h.performed_at).toLocaleDateString()}
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
