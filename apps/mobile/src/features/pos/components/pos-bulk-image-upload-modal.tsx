import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

interface PosBulkImageUploadModalProps {
  visible: boolean;
  onClose: () => void;
}

export function PosBulkImageUploadModal({ visible, onClose }: PosBulkImageUploadModalProps) {
  const [step, setStep] = useState<'intro' | 'upload' | 'results'>('intro');
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<{ success: number; failed: number } | null>(null);

  const handleDownloadTemplate = async () => {
    try {
      toastSuccess('Descargando plantilla...');
      Alert.alert(
        'Plantilla ZIP',
        'La plantilla ZIP se descargará en la versión completa. El formato es: SKU-001/01-frente.jpg, SKU-002/foto.png',
        [{ text: 'OK' }]
      );
    } catch (error) {
      toastError('Error al descargar la plantilla');
    }
  };

  const handleFileUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/zip',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      setUploading(true);

      // TODO: Implement actual upload
      setTimeout(() => {
        setUploading(false);
        setStep('results');
        setResults({ success: 0, failed: 0 });
        toastSuccess('Archivo ZIP cargado (simulación)');
      }, 2000);
    } catch (error) {
      setUploading(false);
      toastError('Error al cargar el archivo ZIP');
    }
  };

  const handleExecuteUpload = async () => {
    try {
      setUploading(true);
      // TODO: Implement actual bulk image upload execution
      setTimeout(() => {
        setUploading(false);
        toastSuccess('Carga de imágenes completada (simulación)');
        onClose();
        setStep('intro');
      }, 2000);
    } catch (error) {
      setUploading(false);
      toastError('Error en la carga de imágenes');
    }
  };

  const handleClose = () => {
    onClose();
    setStep('intro');
    setResults(null);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={handleClose} style={styles.backBtn}>
            <Icon name="x" size={24} color={colorScales.gray[700]} />
          </Pressable>
          <Text style={styles.title}>Carga Masiva de Imágenes</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Step Indicator */}
        <View style={styles.stepIndicator}>
          <View style={[styles.stepDot, step === 'intro' && styles.stepDotActive]} />
          <View style={[styles.stepLine, (step === 'upload' || step === 'results') && styles.stepLineActive]} />
          <View style={[styles.stepDot, step === 'upload' && styles.stepDotActive]} />
          <View style={[styles.stepLine, step === 'results' && styles.stepLineActive]} />
          <View style={[styles.stepDot, step === 'results' && styles.stepDotActive]} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          {step === 'intro' && (
            <View style={styles.stepContent}>
              <Icon name="image" size={48} color={colors.primary} />
              <Text style={styles.stepTitle}>Preparar</Text>
              <Text style={styles.stepDescription}>
                Descarga la plantilla ZIP y carga tu archivo con las imágenes organizadas por SKU.
              </Text>
              <Pressable style={styles.secondaryBtn} onPress={handleDownloadTemplate}>
                <Icon name="download" size={18} color={colors.primary} />
                <Text style={styles.secondaryBtnText}>Descargar Plantilla ZIP</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={() => setStep('upload')}>
                <Text style={styles.primaryBtnText}>Continuar</Text>
              </Pressable>
            </View>
          )}

          {step === 'upload' && (
            <View style={styles.stepContent}>
              <Icon name="file-text" size={48} color={colors.primary} />
              <Text style={styles.stepTitle}>Cargar ZIP</Text>
              <Text style={styles.stepDescription}>
                Selecciona un archivo ZIP (máx. 100MB). Formatos: JPG, PNG, WEBP, etc.
              </Text>
              <Pressable
                style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
                onPress={handleFileUpload}
                disabled={uploading}
              >
                <Icon name="upload" size={24} color="#FFFFFF" />
                <Text style={styles.uploadBtnText}>
                  {uploading ? 'Cargando...' : 'Seleccionar ZIP'}
                </Text>
              </Pressable>
              <Pressable style={styles.backToStepBtn} onPress={() => setStep('intro')}>
                <Text style={styles.backToStepText}>Volver</Text>
              </Pressable>
            </View>
          )}

          {step === 'results' && results && (
            <View style={styles.stepContent}>
              <Icon name="check-circle" size={48} color={colors.primary} />
              <Text style={styles.stepTitle}>Resultados</Text>
              <View style={styles.resultsContainer}>
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Imágenes cargadas:</Text>
                  <Text style={[styles.resultValue, styles.successText]}>{results.success}</Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Fallidas:</Text>
                  <Text style={[styles.resultValue, styles.errorText]}>{results.failed}</Text>
                </View>
              </View>
              <Pressable style={styles.primaryBtn} onPress={handleExecuteUpload}>
                <Text style={styles.primaryBtnText}>Ejecutar Carga</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[8],
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colorScales.gray[300],
  },
  stepDotActive: {
    backgroundColor: colors.primary,
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: colorScales.gray[300],
    marginHorizontal: spacing[2],
  },
  stepLineActive: {
    backgroundColor: colors.primary,
  },
  content: {
    flex: 1,
    padding: spacing[6],
  },
  stepContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
  },
  stepTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  stepDescription: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
    textAlign: 'center',
    maxWidth: 300,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[6],
    alignItems: 'center',
    width: '100%',
  },
  primaryBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  secondaryBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[6],
    width: '100%',
  },
  uploadBtnDisabled: {
    opacity: 0.6,
  },
  uploadBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  backToStepBtn: {
    paddingVertical: spacing[2],
  },
  backToStepText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  resultsContainer: {
    width: '100%',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  resultLabel: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  resultValue: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
  },
  successText: {
    color: colors.primary,
  },
  errorText: {
    color: colors.error,
  },
});
