import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgAccountingService } from '@/features/org/services/org-accounting.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function AccountMappingsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-accounting-mappings'],
    queryFn: () => OrgAccountingService.listMappings({ pageSize: 100 }),
  });

  const mappings = data ?? [];

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
        mappings.length === 0
          ? { icon: 'arrow-left-right', title: 'Sin mapeos', message: 'Configura el mapeo entre cuentas.' }
          : undefined
      }
    >
      {mappings.map((m) => (
        <OrgListItem
          key={m.id}
          title={`${m.source_account}`}
          subtitle={m.source_name}
          description={`→ ${m.target_account_code ?? ''} ${m.target_account_name ?? ''} • ${m.operation}`}
          leftIcon="arrow-left-right"
          rightBadge={
            m.is_active
              ? { label: 'Activo', variant: 'success' }
              : { label: 'Inactivo', variant: 'muted' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
