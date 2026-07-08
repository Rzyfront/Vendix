/**
 * AnuncioDetailScreen — Pantalla detalle de un anuncio.
 *
 * Mirror del flow web `anuncios.component.ts` (preview modal) +
 * `anuncios.component.ts:531-566` (cardConfig), expandido a full-screen
 * con StickyHeader + ScrollView + sections.
 *
 * En el web el detalle se renderiza dentro de un preview modal XL.
 * En mobile dedicamos una ruta para que el contenido sea legible y
 * se puedan disparar las mismas acciones (Copiar / Descargar / Compartir
 * / Abrir tienda / Eliminar).
 */

import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, Linking, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { AnunciosService } from '@/features/store/services/anuncios.service';
import { AdCreativeAssetService } from '@/features/store/services/ad-creative-asset.service';

import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';

import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

import { ANUNCIO_LABELS, ANUNCIO_FORMAT_LABEL, ANUNCIO_STATE_LABEL } from '@/features/store/constants/anuncio-labels';
import type { BadgeVariant } from '@/shared/components/badge/badge';
import type { MarketingAdCreative, MarketingAdEcommerceDomain } from '@/features/store/types/anuncios.types';

import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

const STATE_BADGE_VARIANT: Record<MarketingAdCreative['status'], BadgeVariant> = {
  draft: 'neutral',
  processing: 'warning',
  completed: 'success',
  failed: 'error',
};

function formatDate(value?: string | null): string {
  if (!value) return 'Sin fecha';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return 'Sin fecha';
  }
}

export default function AnuncioDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const numericId = Number(id);
  const validId = Number.isFinite(numericId) && numericId > 0;

  // Fetch detalle
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['anuncio', numericId],
    queryFn: () => AnunciosService.getById(numericId),
    enabled: validId,
  });

  // Fetch ecommerce domain
  const { data: ecommerce } = useQuery({
    queryKey: ['anuncio-ecommerce-domain'],
    queryFn: () => AnunciosService.getEcommerceDomain(),
    enabled: validId,
  });

  const ecommerceUrl = (() => {
    if (!ecommerce) return null;
    if (ecommerce.url) return ecommerce.url;
    if (ecommerce.hostname) {
      return `https://${ecommerce.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
    }
    return null;
  })();

  const deleteMutation = useMutation({
    mutationFn: () => AnunciosService.remove(numericId),
    onSuccess: (res) => {
      toastSuccess(res?.message || ANUNCIO_LABELS.toastDeleted);
      queryClient.invalidateQueries({ queryKey: ['anuncios'] });
      queryClient.invalidateQueries({ queryKey: ['anuncio-stats'] });
      router.back();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        ANUNCIO_LABELS.toastErrDelete;
      toastError(msg);
    },
  });

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleCopy = useCallback(() => {
    if (data) void AdCreativeAssetService.copyImage(data);
  }, [data]);
  const handleDownload = useCallback(() => {
    if (data) void AdCreativeAssetService.download(data);
  }, [data]);
  const handleShare = useCallback(() => {
    if (data) void AdCreativeAssetService.share(data);
  }, [data]);
  const handleOpenStore = useCallback(() => {
    if (ecommerceUrl) {
      Linking.openURL(ecommerceUrl).catch(() => {
        // ignore
      });
    }
  }, [ecommerceUrl]);
  const handleCopyPost = useCallback(() => {
    if (data) void AdCreativeAssetService.copyPostCopy(data);
  }, [data]);

  if (!validId) {
    return (
      <View style={styles.container}>
        <StickyHeader title={ANUNCIO_LABELS.titleSingular} onBack={handleBack} />
        <EmptyState
          icon="alert-circle"
          title="Anuncio no encontrado"
          description="El identificador del anuncio no es valido."
          actionLabel="Volver a la lista"
          onAction={handleBack}
        />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StickyHeader title={ANUNCIO_LABELS.titleSingular} onBack={handleBack} />
        <View style={styles.center}>
          <Spinner />
        </View>
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.container}>
        <StickyHeader title={ANUNCIO_LABELS.titleSingular} onBack={handleBack} />
        <EmptyState
          icon="alert-circle"
          title={ANUNCIO_LABELS.emptyNoAnunciosLoad}
          description={ANUNCIO_LABELS.toastErrLoad}
          actionLabel={ANUNCIO_LABELS.ctaRefresh}
          onAction={() => void refetch()}
        />
      </View>
    );
  }

  const products =
    data.creative_products
      ?.map((item) => item.product?.name)
      .filter(Boolean)
      .join(', ') || '';
  const description = data.description || data.prompt || 'Sin descripcion.';
  const hasImage = Boolean(data.image_url);
  const hasPost = Boolean(data.post_copy?.trim());

  return (
    <View style={styles.container}>
      <StickyHeader
        title={data.title}
        subtitle={`${ANUNCIO_STATE_LABEL[data.status]} · ${ANUNCIO_FORMAT_LABEL[data.format]}`}
        onBack={handleBack}
        actions={[
          {
            label: ANUNCIO_LABELS.ctaEdit,
            variant: 'outline',
            icon: 'edit',
            onPress: () => {
              // Edit no implementado en MVP mobile; el web tampoco usa el
              // endpoint PATCH. Mostramos toast informativo.
              toastError('La edicion detallada no esta disponible en mobile.');
            },
          },
        ]}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          // RN 0.81+ uses RefreshControl in ScrollView
          undefined
        }
      >
        {isRefetching ? (
          <View style={styles.refetching}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}

        {/* Identidad */}
        <Card style={styles.section}>
          <Text style={styles.sectionLabel}>{ANUNCIO_LABELS.sectionIdentidad}</Text>
          <Text style={styles.sectionTitle}>{data.title}</Text>
          <View style={styles.row}>
            <Badge
              label={ANUNCIO_STATE_LABEL[data.status]}
              variant={STATE_BADGE_VARIANT[data.status]}
              size="sm"
            />
            <Text style={styles.sectionMeta}>
              {ANUNCIO_LABELS.statsCompleted}: {formatDate(data.created_at)}
            </Text>
          </View>
        </Card>

        {/* Formato + descripcion */}
        <Card style={styles.section}>
          <Text style={styles.sectionLabel}>{ANUNCIO_LABELS.formatLabel}</Text>
          <Text style={styles.sectionBody}>
            {ANUNCIO_FORMAT_LABEL[data.format]} · {description}
          </Text>
        </Card>

        {/* Productos */}
        {products ? (
          <Card style={styles.section}>
            <Text style={styles.sectionLabel}>{ANUNCIO_LABELS.sectionProductos}</Text>
            <Text style={styles.sectionBody}>{products}</Text>
          </Card>
        ) : null}

        {/* Post sugerido */}
        {hasPost ? (
          <Card style={styles.section}>
            <View style={styles.postHeader}>
              <View style={styles.postHeaderTitleRow}>
                <Icon name="message-square" size={16} color={colors.primary} />
                <Text style={styles.sectionLabel}>{ANUNCIO_LABELS.postSuggested}</Text>
              </View>
              <Button
                variant="ghost"
                size="sm"
                onPress={handleCopyPost}
                title={ANUNCIO_LABELS.ctaCopy}
                leftIcon={<Icon name="copy" size={14} color={colorScales.gray[700]} />}
              />
            </View>
            <Text style={styles.postText}>{data.post_copy}</Text>
          </Card>
        ) : null}

        {/* Actions stacked footer */}
        <View style={styles.footer}>
          {hasImage ? (
            <>
              <Button
                variant="outline"
                size="md"
                onPress={handleCopy}
                title={ANUNCIO_LABELS.ctaCopy}
                leftIcon={<Icon name="copy" size={15} color={colorScales.gray[700]} />}
              />
              <Button
                variant="outline"
                size="md"
                onPress={handleDownload}
                title={ANUNCIO_LABELS.ctaDownload}
                leftIcon={<Icon name="download" size={15} color={colorScales.gray[700]} />}
              />
              <Button
                variant="outline"
                size="md"
                onPress={handleShare}
                title={ANUNCIO_LABELS.ctaShare}
                leftIcon={<Icon name="share-2" size={15} color={colorScales.gray[700]} />}
              />
            </>
          ) : null}
          {ecommerceUrl ? (
            <Button
              variant="primary"
              size="md"
              onPress={handleOpenStore}
              title={ANUNCIO_LABELS.ctaOpenStore}
              leftIcon={<Icon name="external-link" size={15} color={colors.card} />}
            />
          ) : null}
          <Button
            variant="outline"
            size="md"
            onPress={() => setConfirmDelete(true)}
            title={ANUNCIO_LABELS.rowDelete}
            leftIcon={<Icon name="trash-2" size={15} color={colors.error} />}
          />
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={ANUNCIO_LABELS.dialogDeleteTitle}
        message={ANUNCIO_LABELS.dialogDeleteMessageTemplate.replace(
          '{title}',
          data.title,
        )}
        confirmLabel={ANUNCIO_LABELS.dialogDeleteConfirm}
        cancelLabel={ANUNCIO_LABELS.dialogDeleteDeny}
        destructive
        loading={deleteMutation.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    gap: spacing[3],
  },
  refetching: {
    paddingVertical: spacing[2],
  },
  section: {
    padding: spacing[4],
    gap: spacing[2],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colorScales.gray[500],
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  sectionBody: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  sectionMeta: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[1],
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  postHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  postText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    lineHeight: 22,
  },
  footer: {
    gap: spacing[2],
    paddingTop: spacing[4],
  },
});
