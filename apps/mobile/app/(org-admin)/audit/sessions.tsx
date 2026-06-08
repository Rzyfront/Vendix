import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function SessionsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-audit-sessions'],
    queryFn: () => OrgAuditService.listSessions({ pageSize: 100 }),
  });

  const sessions = data ?? [];

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
        sessions.length === 0
          ? { icon: 'monitor', title: 'Sin sesiones activas', message: 'No hay sesiones registradas.' }
          : undefined
      }
    >
      {sessions.map((s) => (
        <OrgListItem
          key={s.id}
          title={s.user_email ?? s.user_name ?? 'Usuario'}
          subtitle={`${s.device ?? 'Dispositivo'} • ${s.location ?? s.ip_address ?? ''}`}
          description={`Activo: ${new Date(s.last_active_at).toLocaleString()}`}
          leftIcon={s.device?.includes('Mobile') ? 'smartphone' : 'monitor'}
          rightBadge={s.is_current ? { label: 'Actual', variant: 'primary' } : undefined}
          rightMeta={new Date(s.expires_at).toLocaleDateString()}
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
