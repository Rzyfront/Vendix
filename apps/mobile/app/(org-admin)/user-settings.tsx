import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgProfileService } from '@/features/org/services/org-profile.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { OrgDetailRow } from '@/shared/components/org-detail-row';

export default function UserSettingsScreen() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-user-settings'],
    queryFn: () => OrgProfileService.getSettings(),
  });

  const mutation = useMutation({
    mutationFn: (body: any) => OrgProfileService.updateSettings(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-user-settings'] });
      Alert.alert('Éxito', 'Preferencias actualizadas');
    },
    onError: () => Alert.alert('Error', 'No se pudieron guardar los cambios'),
  });

  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(data?.theme ?? 'auto');
  const [language, setLanguage] = useState(data?.language ?? 'es-CO');
  const [notificationsEnabled, setNotificationsEnabled] = useState(data?.notifications_enabled ?? true);
  const [emailNotifications, setEmailNotifications] = useState(data?.email_notifications ?? true);
  const [pushNotifications, setPushNotifications] = useState(data?.push_notifications ?? true);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const onSave = () => {
    mutation.mutate({
      theme,
      language,
      timezone: data?.timezone ?? 'America/Bogota',
      notifications_enabled: notificationsEnabled,
      email_notifications: emailNotifications,
      push_notifications: pushNotifications,
      sms_notifications: data?.sms_notifications ?? false,
      marketing_emails: data?.marketing_emails ?? false,
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

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
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Apariencia</Text>
          <Card>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Tema</Text>
              <View style={styles.cycleRow}>
                {(['light', 'dark', 'auto'] as const).map((t) => (
                  <Text
                    key={t}
                    onPress={() => setTheme(t)}
                    style={[styles.cycle, theme === t && styles.cycleActive]}
                  >
                    {t === 'light' ? 'Claro' : t === 'dark' ? 'Oscuro' : 'Auto'}
                  </Text>
                ))}
              </View>
            </View>
            <OrgDetailRow label="Idioma" value={language === 'es-CO' ? 'Español (Colombia)' : language} />
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notificaciones</Text>
          <Card>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Notificaciones activas</Text>
              <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} trackColor={{ true: colors.primary, false: colorScales.gray[300] }} />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Email</Text>
              <Switch value={emailNotifications} onValueChange={setEmailNotifications} trackColor={{ true: colors.primary, false: colorScales.gray[300] }} />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Push</Text>
              <Switch value={pushNotifications} onValueChange={setPushNotifications} trackColor={{ true: colors.primary, false: colorScales.gray[300] }} />
            </View>
          </Card>
        </View>

        <View style={styles.actions}>
          <Button
            title={mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            onPress={onSave}
            disabled={mutation.isPending}
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
  section: { marginBottom: spacing[4] },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
  },
  rowLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },
  cycleRow: {
    flexDirection: 'row',
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.full,
    padding: 2,
  },
  cycle: {
    fontSize: typography.fontSize.xs,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.medium,
  },
  cycleActive: {
    backgroundColor: colors.primary,
    color: '#fff',
    borderRadius: borderRadius.full,
  },
  actions: { marginTop: spacing[4] },
});
