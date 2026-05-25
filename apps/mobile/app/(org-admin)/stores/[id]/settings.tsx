import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { OrgStoreService } from '@/features/org/services';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Input } from '@/shared/components/input/input';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

const TIMEZONE_OPTIONS = [
  { value: 'America/Bogota', label: 'Bogotá (UTC-5)' },
  { value: 'America/Medellin', label: 'Medellín (UTC-5)' },
  { value: 'America/Cali', label: 'Cali (UTC-5)' },
  { value: 'America/New_York', label: 'Nueva York (UTC-5)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
  { value: 'Europe/Madrid', label: 'Madrid (UTC+1)' },
];

export default function StoreSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const storeId = Number(id);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['org-store-settings', storeId],
    queryFn: () => OrgStoreService.getSettings(storeId),
    enabled: !!storeId,
  });

  const [timezone, setTimezone] = useState('America/Bogota');
  const [currency, setCurrency] = useState('COP');
  const [lowStockThreshold, setLowStockThreshold] = useState('10');

  useState(() => {
    if (settings) {
      setTimezone(settings.timezone || 'America/Bogota');
      setCurrency(settings.currency || 'COP');
      setLowStockThreshold(String(settings.low_stock_threshold ?? 10));
    }
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => OrgStoreService.updateSettings(storeId, { settings: data }),
    onSuccess: () => {
      toastSuccess('Configuración guardada exitosamente');
      router.back();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al guardar configuración';
      toastError(message);
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      timezone,
      currency,
      low_stock_threshold: Number(lowStockThreshold) || 10,
    });
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Spinner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* General Settings */}
        <Card>
          <Card.Header title="General" />
          <Card.Body>
            <Text style={styles.label}>Zona Horaria</Text>
            <View style={styles.chipRow}>
              {TIMEZONE_OPTIONS.map((opt) => (
                <View
                  key={opt.value}
                  style={[styles.chip, timezone === opt.value && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipText, timezone === opt.value && styles.chipTextActive]}
                    onPress={() => setTimezone(opt.value)}
                  >
                    {opt.label}
                  </Text>
                </View>
              ))}
            </View>

            <View style={{ height: spacing[4] }} />

            <Input
              label="Moneda"
              value={currency}
              onChangeText={setCurrency}
              placeholder="COP"
              helperText="Código de moneda (ej. COP, USD, EUR)"
            />
          </Card.Body>
        </Card>

        {/* Inventory Settings */}
        <Card>
          <Card.Header title="Inventario" />
          <Card.Body>
            <Input
              label="Umbral de Stock Bajo"
              value={lowStockThreshold}
              onChangeText={setLowStockThreshold}
              placeholder="10"
              keyboardType="number-pad"
              helperText="Notificar cuando el stock baje de esta cantidad"
            />
          </Card.Body>
        </Card>

        {/* Spacer */}
        <View style={{ height: spacing[20] }} />
      </ScrollView>

      {/* Fixed bottom save button */}
      <View style={styles.footer}>
        <Button
          title="Guardar Configuración"
          onPress={handleSave}
          loading={updateMutation.isPending}
          disabled={updateMutation.isPending}
          fullWidth
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[4],
    paddingBottom: spacing[4],
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colors.text.secondary,
    marginBottom: spacing[1.5],
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  chipTextActive: {
    color: colors.background,
  },
  footer: {
    padding: spacing[4],
    paddingBottom: spacing[6],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
});
