import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useAuthStore } from '@/core/store/auth.store';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgSectionHeader } from '@/shared/components/org-section-header';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgBadge } from '@/shared/components/org-badge';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function StoresList() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-stores-list'],
    queryFn: () => OrgStoreService.list({ pageSize: 100 }),
  });

  const stores = data?.data ?? [];

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
        stores.length === 0
          ? {
              icon: 'store',
              title: 'No hay tiendas',
              message: 'Crea tu primera tienda para empezar.',
              actionLabel: 'Crear tienda',
              onAction: () => router.push('/(org-admin)/stores/create' as never),
            }
          : undefined
      }
    >
      <View style={styles.headerActions}>
        <View style={styles.orgInfo}>
          <Text style={styles.orgName}>{user?.organizations?.name ?? 'Organización'}</Text>
          <Text style={styles.orgSlug}>{stores.length} tienda{stores.length === 1 ? '' : 's'}</Text>
        </View>
        <Pressable
          style={styles.addBtn}
          onPress={() => router.push('/(org-admin)/stores/create' as never)}
        >
          <Icon name="plus" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Nueva</Text>
        </Pressable>
      </View>

      <View style={styles.list}>
        {stores.map((s) => (
          <OrgListItem
            key={s.id}
            title={s.name}
            subtitle={s.slug}
            description={`${s.store_type} • ${s.timezone}`}
            leftIcon="store"
            leftIconColor={s.is_active ? colors.primary : colorScales.gray[400]}
            rightBadge={
              s.is_active
                ? { label: 'Activa', variant: 'success' }
                : { label: 'Inactiva', variant: 'muted' }
            }
            rightMeta={s.onboarding ? 'Onboarding' : undefined}
            onPress={() => router.push(`/(org-admin)/stores/${s.id}/settings` as never)}
            chevron
          />
        ))}
      </View>
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  orgInfo: { flex: 1 },
  orgName: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  orgSlug: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 999,
    gap: 4,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: typography.fontWeight.semibold,
    fontSize: typography.fontSize.sm,
  },
  list: {},
});
