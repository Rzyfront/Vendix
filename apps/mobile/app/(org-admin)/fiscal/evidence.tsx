import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgFiscalService } from '@/features/org/services/org-fiscal.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function FiscalEvidenceScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-fiscal-evidence'],
    queryFn: () => OrgFiscalService.listEvidence({ pageSize: 100 }),
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
          ? { icon: 'archive', title: 'Sin evidencias', message: 'No hay evidencias fiscales almacenadas.' }
          : undefined
      }
    >
      {list.map((e) => (
        <OrgListItem
          key={e.id}
          title={e.title}
          subtitle={e.file_name}
          description={e.description}
          leftIcon={
            e.type === 'INVOICE' ? 'file-text' :
            e.type === 'DECLARATION' ? 'file-text' :
            e.type === 'CLOSING' ? 'lock' :
            e.type === 'RECEIPT' ? 'receipt' :
            'archive'
          }
          rightBadge={{ label: e.type, variant: 'muted' }}
          rightMeta={new Date(e.created_at).toLocaleDateString()}
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
