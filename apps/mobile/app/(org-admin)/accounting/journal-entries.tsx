import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgAccountingService } from '@/features/org/services/org-accounting.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function JournalEntriesScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-accounting-journal'],
    queryFn: () => OrgAccountingService.listJournalEntries({ pageSize: 100 }),
  });

  const entries = data ?? [];

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
        entries.length === 0
          ? { icon: 'scroll-text', title: 'Sin asientos contables', message: 'Los asientos aparecerán aquí.' }
          : undefined
      }
    >
      {entries.map((e) => (
        <OrgListItem
          key={e.id}
          title={`#${e.entry_number}`}
          subtitle={e.description}
          description={`${new Date(e.date).toLocaleDateString()} • ${e.source ?? 'manual'}`}
          leftIcon="scroll-text"
          rightValue={formatCurrency(e.total_debit)}
          rightBadge={
            e.status === 'POSTED'
              ? { label: 'Contabilizado', variant: 'success' }
              : e.status === 'VOIDED'
              ? { label: 'Anulado', variant: 'error' }
              : { label: 'Borrador', variant: 'warning' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
