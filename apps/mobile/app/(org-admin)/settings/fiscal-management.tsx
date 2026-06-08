import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { OrgBadge } from '@/shared/components/org-badge';

export default function FiscalManagementScreen() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['org-fiscal-status'],
    queryFn: () => OrgConfigService.getFiscalStatus(),
  });

  const startMutation = useMutation({
    mutationFn: () => OrgConfigService.startWizard('fiscal'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-fiscal-status'] });
      Alert.alert('Asistente iniciado', 'Sigue los pasos para configurar el manejo fiscal.');
    },
    onError: () => Alert.alert('Error', 'No se pudo iniciar el asistente'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await statusQuery.refetch();
    setRefreshing(false);
  };

  if (statusQuery.isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  const status = statusQuery.data;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Card>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Manejo fiscal</Text>
              <Text style={styles.subtitle}>
                Configura el régimen fiscal de la organización paso a paso.
              </Text>
            </View>
            <OrgBadge
              label={status?.is_active ? 'Activo' : 'Inactivo'}
              variant={status?.is_active ? 'success' : 'muted'}
            />
          </View>

          {status?.is_active ? (
            <>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${status.progress_percent ?? 0}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                Progreso: {status.progress_percent ?? 0}%
              </Text>
              <Text style={styles.stepsLabel}>
                Pasos completados: {(status.steps_completed ?? []).length}
              </Text>
            </>
          ) : (
            <Text style={styles.placeholder}>
              El asistente fiscal no está activo. Inícialo para configurar paso a paso.
            </Text>
          )}

          <View style={styles.actions}>
            <Button
              title={status?.is_active ? 'Continuar asistente' : 'Iniciar asistente'}
              onPress={() => startMutation.mutate()}
              loading={startMutation.isPending}
              fullWidth
            />
          </View>
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recomendaciones</Text>
          <Card>
            <View style={styles.tip}>
              <Icon name="info" size={16} color={colorScales.blue[500]} />
              <Text style={styles.tipText}>
                Ten a la mano: NIT, RUT, certificado de existencia y representación legal.
              </Text>
            </View>
            <View style={styles.tip}>
              <Icon name="info" size={16} color={colorScales.blue[500]} />
              <Text style={styles.tipText}>
                Algunas decisiones son irreversibles (régimen, responsabilidad).
              </Text>
            </View>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4] },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerText: { flex: 1, marginRight: spacing[2] },
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900] },
  subtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  progressTrack: {
    height: 8,
    backgroundColor: colorScales.gray[200],
    borderRadius: 4,
    marginTop: spacing[4],
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  progressLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[2],
    textAlign: 'right',
  },
  stepsLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    marginTop: spacing[1],
  },
  placeholder: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[3],
  },
  actions: { marginTop: spacing[4] },
  section: { marginTop: spacing[4] },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  tipText: { flex: 1, fontSize: typography.fontSize.sm, color: colorScales.gray[700] },
});
