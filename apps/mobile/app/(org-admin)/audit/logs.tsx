import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function AuditLogsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-audit-logs'],
    queryFn: () => OrgAuditService.listLogs({ pageSize: 100 }),
  });

  const logs = data ?? [];

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
        logs.length === 0
          ? { icon: 'eye', title: 'Sin logs', message: 'No hay actividad registrada.' }
          : undefined
      }
    >
      {logs.map((l) => (
        <OrgListItem
          key={l.id}
          title={l.action}
          subtitle={`${l.user_email ?? l.user_name ?? 'Sistema'} • ${l.resource}`}
          description={l.description}
          leftIcon={
            l.action === 'LOGIN' ? 'log-in' :
            l.action === 'LOGOUT' ? 'log-out' :
            l.action === 'CREATE' ? 'plus' :
            l.action === 'UPDATE' ? 'edit-2' :
            l.action === 'DELETE' ? 'trash' :
            'eye'
          }
          rightMeta={new Date(l.created_at).toLocaleString()}
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
