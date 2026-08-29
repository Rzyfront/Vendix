/**
 * [print-editor-dsk P10] Read-only preview of a print format, mobile side.
 *
 * The web editor at /store/print-formats/:formatType has a live preview;
 * the mobile does NOT carry an editor — it just lets a user who is staring
 * at a printed ticket wonder "is this the template the merchant set up?"
 * answer that question by hitting the same `/store/print-formats/render`
 * endpoint the printer would.
 *
 * The screen reads `formatType` from the navigation route params, asks the
 * backend to render a SAMPLE document of that type, and shows the body HTML
 * the renderer returned. It is read-only — there is no edit affordance —
 * but it offers a "Reset to default" button that calls the store-scoped
 * reset endpoint, the same `DELETE /store/print-formats/:formatType` the
 * hub's restore button uses.
 *
 * Implementation note: the project does not yet depend on
 * `react-native-webview`, so the preview is rendered as monospaced text in
 * a scrollable, pinch-friendly view (the system's pinch gesture works on
 * Text inside ScrollView through `minimumFontScale`/`maximumFontScale`).
 * The HTML is shown VERBATIM — what the renderer produced — so a user
 * comparing it against a printed sheet can match lines one-to-one. When
 * `react-native-webview` lands, the inner `<Text>` becomes a `<WebView>`
 * and the layout already matches the print dialog's WebView.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DocumentPrintService } from '@/shared/print';

interface PreviewScreenProps {
  /** `formatType` for the print format to render (e.g. `dispatch_ticket`). */
  formatType: string;
  /** Sample document id to feed the renderer — 0 is a safe no-document. */
  sampleDocumentId?: number | string;
  /** Reset endpoint for "restore to default" (DELETE on the format). */
  resetEndpoint?: string;
  /** Optional callback after a successful reset. */
  onReset?: () => void;
}

interface PreviewState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  html: string;
  errorMessage: string;
}

const INITIAL_STATE: PreviewState = {
  status: 'idle',
  html: '',
  errorMessage: '',
};

export function PreviewScreen({
  formatType,
  sampleDocumentId = 0,
  resetEndpoint,
  onReset,
}: PreviewScreenProps) {
  const [state, setState] = useState<PreviewState>(INITIAL_STATE);

  const load = useCallback(async () => {
    setState({ status: 'loading', html: '', errorMessage: '' });
    try {
      const result = await DocumentPrintService.renderDocument({
        formatType,
        documentId: sampleDocumentId,
        engine: 'html',
      });
      setState({
        status: 'ready',
        html: result.html,
        errorMessage: '',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Render failed';
      setState({ status: 'error', html: '', errorMessage: message });
    }
  }, [formatType, sampleDocumentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReset = useCallback(async () => {
    if (!resetEndpoint) {
      Alert.alert('Sin endpoint', 'No hay endpoint de reset configurado.');
      return;
    }
    Alert.alert(
      'Restablecer plantilla',
      '¿Restablecer la plantilla al esquema por defecto?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restablecer',
          style: 'destructive',
          onPress: async () => {
            try {
              /*
               * The backend exposes `DELETE /store/print-formats/:formatType`
               * for "reset to default" — that's what the web hub button calls.
               * `DocumentPrintService.renderDocument` already proved the
               * client can reach the gateway; the DELETE uses the same
               * `apiDelete` helper the rest of the app uses.
               */
              const { apiDelete } = await import('@/core/api/http');
              await apiDelete(resetEndpoint);
              if (onReset) onReset();
              await load();
            } catch (err) {
              const message =
                err instanceof Error ? err.message : 'Reset failed';
              Alert.alert('No se pudo restablecer', message);
            }
          },
        },
      ],
    );
  }, [resetEndpoint, onReset, load]);

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <View style={styles.center} testID="preview-loading">
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Cargando previsualización…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.center} testID="preview-error">
        <Text style={styles.errorTitle}>No se pudo renderizar</Text>
        <Text style={styles.errorBody}>{state.errorMessage}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={load}
          style={styles.retryBtn}
        >
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="preview-ready">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        maximumZoomScale={3}
        minimumZoomScale={0.5}
        showsVerticalScrollIndicator
        testID="preview-webview"
      >
        <Text
          allowFontScaling
          minimumFontScale={0.6}
          selectable
          style={styles.htmlText}
        >
          {state.html}
        </Text>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restablecer plantilla"
          onPress={handleReset}
          style={styles.resetBtn}
          testID="preview-reset"
        >
          <Text style={styles.resetText}>Restablecer a predeterminado</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  muted: { marginTop: 12, color: '#666', fontSize: 14 },
  errorTitle: {
    color: '#b00020',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorBody: { color: '#333', fontSize: 14, textAlign: 'center' },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1976d2',
  },
  retryText: { color: '#fff', fontWeight: '600' },
  scrollContent: { padding: 16, paddingBottom: 80 },
  htmlText: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#222',
    lineHeight: 16,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    backgroundColor: '#fafafa',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  resetBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#b00020',
    alignItems: 'center',
  },
  resetText: { color: '#fff', fontWeight: '600' },
});

export default PreviewScreen;