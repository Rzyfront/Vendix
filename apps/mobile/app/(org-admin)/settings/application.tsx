import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { OrgDetailRow } from '@/shared/components/org-detail-row';

export default function ApplicationSettings() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [appName, setAppName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [timezone, setTimezone] = useState('America/Bogota');
  const [currency, setCurrency] = useState('COP');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-settings-application'],
    queryFn: () => OrgConfigService.getSettings(),
  });

  useEffect(() => {
    if (data) {
      setAppName(data.app_name ?? '');
      setContactEmail(data.contact_email ?? '');
      setContactPhone(data.contact_phone ?? '');
      setTimezone(data.timezone ?? 'America/Bogota');
      setCurrency(data.currency ?? 'COP');
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (body: any) => OrgConfigService.updateSettings(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-settings-application'] });
      Alert.alert('Éxito', 'Configuración guardada');
    },
    onError: () => Alert.alert('Error', 'No se pudo guardar la configuración'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const onSave = () => {
    mutation.mutate({ app_name: appName, contact_email: contactEmail, contact_phone: contactPhone, timezone, currency });
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General</Text>
          <Card>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Nombre de la app</Text>
              <Input value={appName} onChangeText={setAppName} placeholder="Vendix" />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email de contacto</Text>
              <Input value={contactEmail} onChangeText={setContactEmail} placeholder="contacto@empresa.com" keyboardType="email-address" autoCapitalize="none" />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Teléfono de contacto</Text>
              <Input value={contactPhone} onChangeText={setContactPhone} placeholder="+57 300 000 0000" keyboardType="phone-pad" />
            </View>
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Región</Text>
          <Card>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Zona horaria</Text>
              <Input value={timezone} onChangeText={setTimezone} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Moneda</Text>
              <Input value={currency} onChangeText={setCurrency} autoCapitalize="characters" />
            </View>
          </Card>
        </View>

        <View style={styles.actions}>
          <Button title={mutation.isPending ? 'Guardando…' : 'Guardar'} onPress={onSave} disabled={mutation.isPending} fullWidth />
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
  field: { marginVertical: spacing[2] },
  fieldLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    marginBottom: spacing[1],
  },
  actions: { marginTop: spacing[4] },
});
