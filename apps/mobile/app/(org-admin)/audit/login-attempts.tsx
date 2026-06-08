import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function LoginAttemptsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-audit-login-attempts'],
    queryFn: () => OrgAuditService.listLoginAttempts({ pageSize: 100 }),
  });

  const attempts = data ?? [];

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
        attempts.length === 0
          ? { icon: 'log-in', title: 'Sin intentos', message: 'No hay intentos de inicio de sesión registrados.' }
          : undefined
      }
    >
      {attempts.map((a) => (
        <OrgListItem
          key={a.id}
          title={a.email}
          subtitle={a.ip_address}
          description={a.failure_reason}
          leftIcon={a.status === 'SUCCESS' ? 'check-circle' : a.status === 'FAILED' ? 'x-circle' : 'shield-alert'}
          leftIconColor={
            a.status === 'SUCCESS' ? colorScales.green[500] :
            a.status === 'FAILED' ? colorScales.red[500] :
            colorScales.amber[500]
          }
          rightBadge={
            a.status === 'SUCCESS'
              ? { label: 'Exitoso', variant: 'success' }
              : a.status === 'FAILED'
              ? { label: 'Fallido', variant: 'error' }
              : { label: 'Bloqueado', variant: 'warning' }
          }
          rightMeta={new Date(a.created_at).toLocaleString()}
          chevron={false}
        />
      ))}
    </OrgPageContainer>
  );
}
