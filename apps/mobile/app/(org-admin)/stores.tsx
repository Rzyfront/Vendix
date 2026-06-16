import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { useAuthStore } from '@/core/store/auth.store';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import { AuthService } from '@/core/auth/auth.service';
import { getQueryClient } from '@/core/api/query-client';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgSectionHeader } from '@/shared/components/org-section-header';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgBadge } from '@/shared/components/org-badge';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { toastSuccess } from '@/shared/components/toast/toast.store';

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

  // Click en una tienda → confirmar y cambiar al entorno STORE_ADMIN de esa tienda
  // (mismo flujo que el drawer en apps/mobile/src/shared/layouts/drawer-menu.tsx).
  // La web hace lo mismo en apps/frontend/src/app/private/modules/organization/stores/stores.component.ts
  // (viewStore) y en el org-admin layout (switchToStoreEnvironment).
  const handleStorePress = (s: { id: string; name: string; slug: string }) => {
    const performSwitch = async () => {
      try {
        await AuthService.switchEnvironment('STORE_ADMIN', s.slug);
        // Limpiar el cache de React Query para que las queries se ejecuten
        // con el nuevo token STORE_ADMIN (no mostrar datos de ORG_ADMIN).
        const qc = getQueryClient();
        await qc.cancelQueries();
        qc.clear();
        toastSuccess(`Cambiado al entorno de la tienda "${s.name}"`);
        router.replace('/(store-admin)/dashboard' as never);
      } catch (error: any) {
        if (Platform.OS === 'web') {
          window.alert(error?.message || 'No se pudo cambiar al entorno de la tienda. Intenta de nuevo.');
        } else {
          Alert.alert(
            'Error al cambiar de entorno',
            error?.message || 'No se pudo cambiar al entorno de la tienda. Intenta de nuevo.',
            [{ text: 'OK' }]
          );
        }
      }
    };

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`¿Deseas cambiar al entorno de administración de la tienda "${s.name}"?\n\nSerás redirigido al panel de administración de STORE_ADMIN para esta tienda específica.`);
      if (confirmed) {
        performSwitch();
      }
    } else {
      Alert.alert(
        'Cambiar al entorno de la tienda',
        `¿Deseas cambiar al entorno de administración de la tienda "${s.name}"?\n\nSerás redirigido al panel de administración de STORE_ADMIN para esta tienda específica.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Cambiar de entorno',
            onPress: performSwitch,
          },
        ]
      );
    }
  };

  const handleStoreSettings = (storeId: string) => {
    router.push(`/(org-admin)/stores/${storeId}/settings` as never);
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
          <View key={s.id} style={styles.storeRow}>
            <View style={styles.storeRowCard}>
              <OrgListItem
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
                onPress={() => handleStorePress(s)}
                style={styles.storeCard}
                chevron
              />
            </View>
            <Pressable
              onPress={() => handleStoreSettings(s.id)}
              style={({ pressed }) => [styles.settingsBtn, pressed && styles.settingsBtnPressed]}
              hitSlop={6}
            >
              <Icon name="settings" size={18} color={colorScales.gray[600]} />
            </Pressable>
          </View>
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
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  storeRowCard: {
    flex: 1,
  },
  // Cancel the OrgListItem's default marginBottom inside the row so the
  // storeRow's marginBottom is the single source of vertical rhythm.
  storeCard: {
    marginBottom: 0,
  },
  settingsBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  settingsBtnPressed: {
    backgroundColor: colorScales.gray[100],
  },
});
