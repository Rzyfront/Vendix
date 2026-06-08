import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgRolesService } from '@/features/org/services/org-roles.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgBadge } from '@/shared/components/org-badge';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function RolesList() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-roles-list'],
    queryFn: () => OrgRolesService.list({ pageSize: 50 }),
  });

  const roles = data ?? [];

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
        roles.length === 0
          ? { icon: 'shield', title: 'No hay roles', message: 'Crea un rol para empezar.' }
          : undefined
      }
    >
      <Text style={styles.helper}>
        Define los permisos que tendrá cada miembro de la organización.
      </Text>
      {roles.map((r) => (
        <OrgListItem
          key={r.id}
          title={r.name}
          subtitle={r.code}
          description={r.description}
          leftIcon="shield"
          leftIconColor={r.is_system ? colorScales.amber[500] : colors.primary}
          rightBadge={
            r.is_system
              ? { label: 'Sistema', variant: 'warning' }
              : r.is_active
              ? { label: 'Activo', variant: 'success' }
              : { label: 'Inactivo', variant: 'muted' }
          }
          rightMeta={`${r.permissions?.length ?? 0} permisos`}
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  helper: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginBottom: spacing[3],
  },
});
