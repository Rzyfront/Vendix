import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InvoiceService } from '@/features/store/services/invoice.service';
import type { DianConfig } from '@/features/store/types/invoice.types';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ListItem } from '@/shared/components/list-item/list-item';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, borderRadius, colorScales, colors } from '@/shared/theme';

function Toggle({
  value,
  onToggle,
  label,
}: {
  value: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable onPress={onToggle} style={styles.toggleRow}>
      <ListItem title={label} />
      <View style={[styles.toggleTrack, value ? styles.toggleTrackActive : styles.toggleTrackInactive]}>
        <View style={[styles.toggleThumb, value ? styles.toggleThumbActive : styles.toggleThumbInactive]} />
      </View>
    </Pressable>
  );
}

export default function DianConfigScreen() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [softwareId, setSoftwareId] = useState('');
  const [pin, setPin] = useState('');
  const [initialized, setInitialized] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ['dian-config'],
    queryFn: () => InvoiceService.getDianConfig(),
  });

  if (config && !initialized) {
    setEnabled(config.enabled);
    setTestMode(config.test_mode);
    setSoftwareId(config.software_id ?? '');
    setPin(config.pin ?? '');
    setInitialized(true);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const dto: Partial<DianConfig> = {
        enabled,
        test_mode: testMode,
        software_id: softwareId || undefined,
        pin: pin || undefined,
      };
      await InvoiceService.updateDianConfig(dto);
      await queryClient.invalidateQueries({ queryKey: ['dian-config'] });
      toastSuccess('Configuración guardada exitosamente');
    } catch (e: any) {
      toastError(e?.message ?? 'Error al guardar configuración');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && !initialized) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.cardMargin}>
          <View style={styles.statusRow}>
            <ListItem title="Estado" />
            {enabled ? (
              <Badge label="Configurado" variant="success" size="sm" />
            ) : (
              <Badge label="No configurado" variant="default" size="sm" />
            )}
          </View>
        </Card>

        <Card style={styles.cardMargin}>
          <View style={styles.cardBody}>
            <Toggle
              label="Facturación electrónica"
              value={enabled}
              onToggle={() => setEnabled(!enabled)}
            />
            <Toggle
              label="Modo de pruebas"
              value={testMode}
              onToggle={() => setTestMode(!testMode)}
            />
          </View>
        </Card>

        <Card style={styles.cardMargin}>
          <View style={styles.cardBody}>
            <Input
              label="Software ID"
              value={softwareId}
              onChangeText={setSoftwareId}
              placeholder="ID del software DIAN"
            />
            <Input
              label="PIN"
              value={pin}
              onChangeText={setPin}
              placeholder="PIN de seguridad"
              secureTextEntry
            />
          </View>
        </Card>

        <Button
          title="Guardar Configuración"
          onPress={handleSave}
          variant="primary"
          loading={saving}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  scrollContent: {
    padding: spacing[4],
    paddingBottom: spacing[24],
  },
  cardMargin: {
    marginBottom: spacing[3],
  },
  cardBody: {
    gap: spacing[3],
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  toggleTrack: {
    width: 48,
    height: 28,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackActive: {
    backgroundColor: colors.primary,
  },
  toggleTrackInactive: {
    backgroundColor: colorScales.gray[300],
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.full,
    backgroundColor: '#fff',
  },
  toggleThumbActive: {
    alignSelf: 'flex-end',
  },
  toggleThumbInactive: {
    alignSelf: 'flex-start',
  },
});
