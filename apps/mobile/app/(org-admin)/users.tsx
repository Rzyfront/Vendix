import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgUsersService } from '@/features/org/services/org-users.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgSectionHeader } from '@/shared/components/org-section-header';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function UsersList() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-users-list'],
    queryFn: () => OrgUsersService.list({ pageSize: 100 }),
  });

  const statsQuery = useQuery({
    queryKey: ['org-users-stats'],
    queryFn: () => OrgUsersService.getStats(),
  });

  const users = data ?? [];
  const stats = statsQuery.data;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), statsQuery.refetch()]);
    setRefreshing(false);
  };

  return (
    <OrgPageContainer
      loading={isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      empty={
        users.length === 0
          ? {
              icon: 'users',
              title: 'No hay usuarios',
              message: 'Invita a tu primer usuario para empezar.',
            }
          : undefined
      }
    >
      {stats ? (
        <View style={styles.section}>
          <OrgStatsGrid
            columns={3}
            stats={[
              { label: 'Total', value: stats.total_users, icon: 'users' },
              { label: 'Activos', value: stats.active_users, icon: 'check-circle', color: colors.success },
              { label: 'Invitados', value: stats.invited_users, icon: 'mail', color: colorScales.amber[500] },
            ]}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <OrgSectionHeader
          title="Usuarios"
          subtitle={`${users.length} en total`}
          action={
            <Text style={styles.linkAction} onPress={() => router.push('/(org-admin)/users' as never)}>
              Ver todos
            </Text>
          }
        />
        {users.slice(0, 25).map((u) => (
          <OrgListItem
            key={u.id}
            title={`${u.first_name} ${u.last_name}`}
            subtitle={u.email}
            description={u.roles?.join(', ')}
            leftIcon="user"
            rightBadge={
              u.state === 'ACTIVE'
                ? { label: 'Activo', variant: 'success' }
                : u.state === 'INVITED'
                ? { label: 'Invitado', variant: 'warning' }
                : u.state === 'SUSPENDED'
                ? { label: 'Suspendido', variant: 'error' }
                : { label: u.state, variant: 'muted' }
            }
            chevron={false}
          />
        ))}
      </View>
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing[4] },
  linkAction: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
});
