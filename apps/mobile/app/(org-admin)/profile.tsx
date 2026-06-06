import { useQuery } from '@tanstack/react-query';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/core/store/auth.store';
import { OrgProfileService } from '@/features/org/services/org-profile.service';
import { Card } from '@/shared/components/card/card';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { OrgSectionHeader } from '@/shared/components/org-section-header';
import { Button } from '@/shared/components/button/button';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Pressable } from 'react-native';

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-profile-me'],
    queryFn: () => OrgProfileService.getMe(),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  const me = data ?? user;
  const initials = me
    ? `${me.first_name?.[0] || ''}${me.last_name?.[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.avatarBlock}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>
            {me?.first_name} {me?.last_name}
          </Text>
          <Text style={styles.email}>{me?.email}</Text>
        </View>

        <View style={styles.section}>
          <OrgSectionHeader title="Cuenta" />
          <Card>
            <OrgDetailRow label="Nombre" value={`${me?.first_name} ${me?.last_name}`} icon="user" />
            <OrgDetailRow label="Email" value={me?.email} icon="mail" />
            <OrgDetailRow label="Teléfono" value={me?.phone} icon="phone" />
          </Card>
        </View>

        {me?.organizations ? (
          <View style={styles.section}>
            <OrgSectionHeader title="Organización" />
            <Card>
              <OrgDetailRow label="Nombre" value={me.organizations.name} icon="building" />
              <OrgDetailRow label="Slug" value={me.organizations.slug} icon="link-2" />
            </Card>
          </View>
        ) : null}

        {(me as any)?.default_store ? (
          <View style={styles.section}>
            <OrgSectionHeader title="Tienda por defecto" />
            <Card>
              <OrgDetailRow label="Nombre" value={(me as any).default_store.name} icon="store" />
              <OrgDetailRow label="Slug" value={(me as any).default_store.slug} icon="link-2" />
            </Card>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            title="Preferencias"
            variant="outline"
            leftIcon="settings"
            onPress={() => router.push('/(org-admin)/user-settings' as never)}
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4], paddingBottom: spacing[8] },
  avatarBlock: { alignItems: 'center', marginVertical: spacing[4] },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: typography.fontWeight.bold,
  },
  name: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginTop: spacing[3],
  },
  email: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  section: { marginTop: spacing[4] },
  actions: { marginTop: spacing[6] },
});
