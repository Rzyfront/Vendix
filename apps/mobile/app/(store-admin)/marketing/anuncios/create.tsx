/**
 * AnuncioCreateWizardScreen — Wizard 2-pasos para crear un anuncio.
 *
 * Replica la web `pages/anuncio-create-wizard-page.component.ts`:
 *  - StickyHeader con back + subtitle con el step "1/2" / "2/2"
 *  - Step ribbon (Crear / Resultado)
 *  - Step 0: format (InputButtons 3 options) + prompt (Textarea) +
 *    action dock (Cancelar / Galeria / Productos / Sugerir / Generar)
 *  - Step 1: result stage con image (parcial / final) + post card +
 *    action dock (Crear otro / Regenerar con correccion / Ver biblioteca)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';

import { AnunciosService } from '@/features/store/services/anuncios.service';
import { AdCreativeAssetService } from '@/features/store/services/ad-creative-asset.service';
import { useAiStream } from '@/features/store/hooks/use-ai-stream';

import { Card } from '@/shared/components/card/card';
import { Button } from '@/shared/components/button/button';
import { Textarea } from '@/shared/components/textarea/textarea';
import { InputButtons } from '@/shared/components/input-buttons/input-buttons';
import { Icon } from '@/shared/components/icon/icon';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { Spinner } from '@/shared/components/spinner/spinner';

import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

import { AnuncioStepRibbon } from '@/features/store/components/anuncio-step-ribbon';
import {
  AnuncioProductsModal,
  type AnuncioSelectedProduct,
} from '@/features/store/components/anuncio-products-modal';
import {
  AnuncioGalleryModal,
  type AnuncioGallerySelection,
} from '@/features/store/components/anuncio-gallery-modal';
import { AnuncioCorrectionModal } from '@/features/store/components/anuncio-correction-modal';

import { ANUNCIO_LABELS, ANUNCIO_FORMAT_OPTIONS } from '@/features/store/constants/anuncio-labels';
import type { AdCreativeFormat, MarketingAdCreative } from '@/features/store/types/anuncios.types';

import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

const WIZARD_STEPS = [
  { label: ANUNCIO_LABELS.wizardStepCreate, icon: 'sparkles' },
  { label: ANUNCIO_LABELS.wizardStepResult, icon: 'image' },
];

function nowDateLabel(): string {
  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

export default function AnuncioCreateWizardScreen() {
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(0);
  const [format, setFormat] = useState<AdCreativeFormat>('story');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<AnuncioSelectedProduct[]>([]);
  const [gallerySelection, setGallerySelection] = useState<AnuncioGallerySelection>({
    referenceIds: [],
    imageIds: [],
  });

  const [productsModalOpen, setProductsModalOpen] = useState(false);
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generatedCreativeId, setGeneratedCreativeId] = useState<number | null>(null);
  const [partialImageUri, setPartialImageUri] = useState<string | null>(null);
  const [result, setResult] = useState<MarketingAdCreative | null>(null);
  const [generationMessage, setGenerationMessage] = useState<string>(ANUNCIO_LABELS.generationPreparing);
  const [generationEcommerceUrl, setGenerationEcommerceUrl] = useState<string | null>(null);

  const stream = useAiStream({
    id: generatedCreativeId ?? 0,
    enabled: generatedCreativeId !== null,
  });

  useEffect(() => {
    if (stream.status === 'done') {
      setGenerating(false);
      if (stream.result) {
        setResult(stream.result);
      }
    } else if (stream.status === 'error') {
      setGenerating(false);
      setCreateError(stream.errorMessage ?? ANUNCIO_LABELS.toastErrGenerate);
    } else if (stream.status === 'streaming') {
      setGenerating(true);
    }
  }, [stream.status, stream.result, stream.errorMessage]);

  useEffect(() => {
    if (stream.message) setGenerationMessage(stream.message);
  }, [stream.message]);

  useEffect(() => {
    const ev = stream.lastEvent;
    if (!ev) return;
    if (ev.type === 'partial_image' && ev.imageBase64) {
      setPartialImageUri(`data:image/png;base64,${ev.imageBase64}`);
    }
    if (ev.type === 'completed') {
      const creative = ev.creative;
      if (creative) {
        setResult(creative);
        setPartialImageUri(creative.image_url ?? null);
      }
      if (ev.post_copy && result) {
        setResult({ ...result, post_copy: ev.post_copy });
      }
    }
    if (ev.type === 'post_copy') {
      if (ev.creative) {
        setResult(ev.creative);
      }
    }
  }, [stream.lastEvent, result]);

  // Load ecommerce URL for post_copy append
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const domain = await AnunciosService.getEcommerceDomain();
        if (cancelled) return;
        if (domain?.url || domain?.hostname) {
          setGenerationEcommerceUrl(
            domain.url || `https://${domain.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`,
          );
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goToStep = useCallback((index: number) => {
    setCurrentStep(Math.max(0, Math.min(WIZARD_STEPS.length - 1, index)));
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleCancel = useCallback(() => {
    router.back();
  }, [router]);

  const handleFormatChange = useCallback((value: string) => {
    setFormat(value as AdCreativeFormat);
  }, []);

  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value);
  }, []);

  const handleSuggest = useCallback(async () => {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const resp = await AnunciosService.suggestPrompt({
        format,
        brief: '',
        product_ids: selectedProducts.map((p) => p.id),
        selected_resource_types: [],
      });
      if (resp.suggested_prompt) setPrompt(resp.suggested_prompt);
      if (resp.suggested_title) setTitle(resp.suggested_title);
      toastSuccess('Sugerencia generada');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        ANUNCIO_LABELS.toastErrSuggest;
      toastError(msg);
    } finally {
      setSuggesting(false);
    }
  }, [suggesting, format, selectedProducts]);

  const buildReferenceImages = useCallback(
    () => {
      return gallerySelection.referenceIds.map((id) => ({
        source_type: id.startsWith('store-qr')
          ? 'qr_store'
          : id.startsWith('product-qr-')
            ? 'qr_product'
            : id.startsWith('store-logo')
              ? 'store_logo'
              : id.startsWith('brand-logo')
                ? 'brand_logo'
                : id.startsWith('ecommerce-logo')
                  ? 'ecommerce_logo'
                  : id.startsWith('slider-')
                    ? 'ecommerce_slider'
                    : 'uploaded',
        label: id,
      }));
    },
    [gallerySelection.referenceIds],
  );

  const handleGenerate = useCallback(async () => {
    if (creating || generating) return;
    if (!prompt.trim()) {
      toastError(ANUNCIO_LABELS.fieldPrompt);
      return;
    }
    setCreating(true);
    setGenerating(true);
    setCreateError(null);
    setResult(null);
    setPartialImageUri(null);
    setGenerationMessage(ANUNCIO_LABELS.generationPreparing);
    setCurrentStep(1);

    try {
      const finalTitle = title.trim() || ANUNCIO_LABELS.defaultTitleDate(nowDateLabel());
      const finalDescription =
        description.trim() || ANUNCIO_LABELS.defaultDescription(nowDateLabel());
      const dto = {
        title: finalTitle,
        description: finalDescription,
        prompt: prompt.trim(),
        format,
        product_ids: selectedProducts.map((p) => p.id),
        product_image_ids: gallerySelection.imageIds,
        reference_images: buildReferenceImages(),
        intent: 'highlight_store',
        channel: 'instagram_story',
        cta: 'visitar_tienda',
        visual_style: 'profesional',
      } as const;
      const res = await AnunciosService.create(dto);
      if (res.data) {
        setResult(res.data);
        setGeneratedCreativeId(res.data.id);
      } else {
        throw new Error('No se recibio el anuncio creado');
      }
    } catch (err: unknown) {
      setGenerating(false);
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        ANUNCIO_LABELS.toastErrCreate;
      setCreateError(msg);
      toastError(msg);
    } finally {
      setCreating(false);
    }
  }, [
    creating,
    generating,
    prompt,
    title,
    description,
    format,
    selectedProducts,
    gallerySelection,
    buildReferenceImages,
  ]);

  const handleConfirmCorrection = useCallback(
    async (text: string) => {
      if (!result?.id || !text.trim()) return;
      setCorrectionModalOpen(false);
      setCreateError(null);
      setPartialImageUri(null);
      setGenerationMessage(ANUNCIO_LABELS.generationPreparing);
      setGenerating(true);
      setCurrentStep(1);
      try {
        AnunciosService.streamGenerate(result.id, {
          correction: text,
          onOpen: () => setGenerating(true),
          onEvent: (event) => {
            if (event.type === 'progress') {
              setGenerationMessage(event.message ?? ANUNCIO_LABELS.generationPreparing);
            }
            if (event.type === 'partial_image' && event.imageBase64) {
              setGenerationMessage(ANUNCIO_LABELS.generationReception);
              setPartialImageUri(`data:image/png;base64,${event.imageBase64}`);
            }
            if (event.type === 'completed' && event.creative) {
              setResult(event.creative);
              setPartialImageUri(event.creative.image_url ?? null);
              setGenerationMessage(ANUNCIO_LABELS.generationReady);
            }
            if (event.type === 'post_copy' && event.creative) {
              setResult(event.creative);
            }
            if (event.type === 'done') {
              setGenerating(false);
            }
            if (event.type === 'error') {
              setGenerating(false);
              setCreateError(event.error ?? ANUNCIO_LABELS.toastErrGenerate);
            }
          },
          onError: () => {
            setGenerating(false);
            setCreateError(ANUNCIO_LABELS.toastErrConnectStream);
          },
        });
      } catch {
        setGenerating(false);
        toastError(ANUNCIO_LABELS.toastErrConnectStream);
      }
    },
    [result?.id],
  );

  const handleCreateAnother = useCallback(() => {
    setCurrentStep(0);
    setResult(null);
    setPartialImageUri(null);
    setGeneratedCreativeId(null);
    setCreateError(null);
    setGenerationMessage(ANUNCIO_LABELS.generationPreparing);
    stream.reset();
  }, [stream]);

  const handleViewLibrary = useCallback(() => {
    router.replace('/(store-admin)/marketing/anuncios' as never);
  }, [router]);

  const handleCopyPost = useCallback(() => {
    if (result) void AdCreativeAssetService.copyPostCopy(result);
  }, [result]);

  const postCopyDisplay = useMemo(() => {
    const base = result?.post_copy?.trim() ?? '';
    if (!base) return '';
    const host = generationEcommerceUrl
      ? generationEcommerceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
      : '';
    if (!host || base.includes(host)) return base;
    return `${base}\n\nConsigue esto y más en ${host}`;
  }, [result?.post_copy, generationEcommerceUrl]);

  const subtitleWithStep = `${ANUNCIO_LABELS.wizardSubtitle} (${currentStep + 1}/2)`;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StickyHeader
        title={ANUNCIO_LABELS.wizardTitle}
        subtitle={subtitleWithStep}
        onBack={handleBack}
      />

      <AnuncioStepRibbon
        steps={WIZARD_STEPS}
        currentStep={currentStep}
        onStepClick={goToStep}
      />

      {currentStep === 0 ? (
        <Step0
          format={format}
          prompt={prompt}
          title={title}
          description={description}
          selectedProducts={selectedProducts}
          gallerySelection={gallerySelection}
          onFormatChange={handleFormatChange}
          onPromptChange={handlePromptChange}
          onTitleChange={setTitle}
          onDescriptionChange={setDescription}
          onCancel={handleCancel}
          onSuggest={handleSuggest}
          onSuggestLoading={suggesting}
          onGenerate={handleGenerate}
          onOpenProducts={() => setProductsModalOpen(true)}
          onOpenGallery={() => setGalleryModalOpen(true)}
          generating={generating || creating}
        />
      ) : (
        <Step1
          message={generationMessage}
          partialImageUri={partialImageUri}
          result={result}
          postCopyDisplay={postCopyDisplay}
          generating={generating}
          error={createError}
          onCreateAnother={handleCreateAnother}
          onRegenerate={() => {
            if (result) {
              setCorrectionModalOpen(true);
            }
          }}
          onViewLibrary={handleViewLibrary}
          onCopyPost={handleCopyPost}
          onBackToStep0={() => {
            if (!generating) setCurrentStep(0);
          }}
        />
      )}

      <AnuncioProductsModal
        visible={productsModalOpen}
        onClose={() => setProductsModalOpen(false)}
        onConfirm={(selected) => {
          setSelectedProducts(selected);
          setProductsModalOpen(false);
        }}
        initialSelected={selectedProducts}
      />

      <AnuncioGalleryModal
        visible={galleryModalOpen}
        onClose={() => setGalleryModalOpen(false)}
        onConfirm={(selection) => {
          setGallerySelection(selection);
          setGalleryModalOpen(false);
        }}
        initialSelection={gallerySelection}
      />

      <AnuncioCorrectionModal
        visible={correctionModalOpen}
        onClose={() => setCorrectionModalOpen(false)}
        onConfirm={handleConfirmCorrection}
        loading={generating}
      />
    </KeyboardAvoidingView>
  );
}

// ── Step 0 ────────────────────────────────────────────────────────────────────

interface Step0Props {
  format: AdCreativeFormat;
  prompt: string;
  title: string;
  description: string;
  selectedProducts: AnuncioSelectedProduct[];
  gallerySelection: AnuncioGallerySelection;
  onFormatChange: (v: string) => void;
  onPromptChange: (v: string) => void;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onCancel: () => void;
  onSuggest: () => void;
  onSuggestLoading: boolean;
  onGenerate: () => void;
  onOpenProducts: () => void;
  onOpenGallery: () => void;
  generating: boolean;
}

function Step0(props: Step0Props) {
  const canSubmit = props.prompt.trim().length > 0 && !props.generating;
  return (
    <ScrollView
      style={styles.stepScroll}
      contentContainerStyle={styles.stepContent}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={styles.heroCard}>
        <View style={styles.heroRow}>
          <View style={styles.heroIcon}>
            <Icon name="sparkles" size={16} color={colors.primary} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>{ANUNCIO_LABELS.wizardHeroTitle}</Text>
            <Text style={styles.heroHelper}>{ANUNCIO_LABELS.wizardHeroHelper}</Text>
          </View>
        </View>
      </Card>

      <Text style={styles.fieldLabel}>{ANUNCIO_LABELS.fieldFormat}</Text>
      <InputButtons
        value={props.format}
        onChange={props.onFormatChange}
        options={ANUNCIO_FORMAT_OPTIONS.map((o) => ({ ...o }))}
      />

      <Text style={styles.fieldLabel}>{ANUNCIO_LABELS.fieldPrompt}</Text>
      <Textarea
        value={props.prompt}
        onChangeText={props.onPromptChange}
        label={ANUNCIO_LABELS.fieldPrompt}
        placeholder="Ejemplo: quiero destacar mi tienda y que las personas escaneen el QR para ver el catalogo. Puedes escribirlo o usar Sugerir anuncio."
        maxLength={2000}
        rows={5}
      />

      <View style={styles.actionDock}>
        <Button
          variant="ghost"
          size="sm"
          onPress={props.onCancel}
          title={ANUNCIO_LABELS.ctaCancel}
          leftIcon={<Icon name="x" size={15} color={colorScales.gray[700]} />}
        />
        <Button
          variant="outline"
          size="sm"
          onPress={props.onOpenGallery}
          title={ANUNCIO_LABELS.ctaGaleria}
          leftIcon={<Icon name="images" size={15} color={colors.primary} />}
        />
        <Button
          variant="outline"
          size="sm"
          onPress={props.onOpenProducts}
          title={ANUNCIO_LABELS.ctaProductos}
          leftIcon={<Icon name="package" size={15} color={colors.primary} />}
        />
        <Button
          variant="outline"
          size="sm"
          onPress={props.onSuggest}
          loading={props.onSuggestLoading}
          disabled={props.onSuggestLoading || props.generating}
          title={ANUNCIO_LABELS.ctaSuggest}
          leftIcon={<Icon name="sparkles" size={15} color={colors.primary} />}
        />
        <Button
          variant="primary"
          size="sm"
          onPress={props.onGenerate}
          loading={props.generating}
          disabled={!canSubmit}
          title={ANUNCIO_LABELS.ctaGenerate}
          leftIcon={<Icon name="image-plus" size={15} color={colors.background} />}
          containerStyle={styles.generateButtonContainer}
        />
      </View>
    </ScrollView>
  );
}

// ── Step 1 ────────────────────────────────────────────────────────────────────

interface Step1Props {
  message: string;
  partialImageUri: string | null;
  result: MarketingAdCreative | null;
  postCopyDisplay: string;
  generating: boolean;
  error: string | null;
  onCreateAnother: () => void;
  onRegenerate: () => void;
  onViewLibrary: () => void;
  onCopyPost: () => void;
  onBackToStep0: () => void;
}

function Step1(props: Step1Props) {
  return (
    <ScrollView
      style={styles.stepScroll}
      contentContainerStyle={styles.stepContent}
    >
      <View style={styles.resultHeader}>
        {props.generating ? (
          <View style={styles.orbit} />
        ) : (
          <View style={styles.checkCircle}>
            <Icon name="check" size={18} color={colors.success} />
          </View>
        )}
        <View style={styles.flex1}>
          <Text style={styles.resultTitle}>
            {props.generating
              ? ANUNCIO_LABELS.resultStageGenerating
              : ANUNCIO_LABELS.resultStageReady}
          </Text>
          <Text style={styles.resultSubtitle}>
            {props.generating
              ? props.message
              : ANUNCIO_LABELS.resultReadySubtitle}
          </Text>
        </View>
      </View>

      {props.error ? (
        <View style={styles.errorBox}>
          <Icon name="triangle-alert" size={16} color={colors.error} />
          <Text style={styles.errorText}>{props.error}</Text>
        </View>
      ) : null}

      <Card style={styles.resultStage}>
        {props.partialImageUri ? (
          <View style={styles.imageStage}>
            {props.partialImageUri.startsWith('data:') ? (
              <Image
                source={{ uri: props.partialImageUri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Icon name="image" size={48} color={colorScales.gray[400]} />
                <Text style={styles.placeholderText}>{props.partialImageUri}</Text>
              </View>
            )}
            {props.generating ? (
              <View style={styles.skeletonOverlay}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.skeletonText}>{props.message}</Text>
              </View>
            ) : null}
          </View>
        ) : props.generating ? (
          <View style={styles.imageStage}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.skeletonText}>{props.message}</Text>
          </View>
        ) : (
          <View style={styles.imageStage}>
            <Icon name="image-off" size={36} color={colorScales.gray[400]} />
            <Text style={styles.placeholderText}>
              {ANUNCIO_LABELS.emptyImagenNo}
            </Text>
          </View>
        )}
      </Card>

      {props.postCopyDisplay ? (
        <Card style={styles.postCard}>
          <View style={styles.postHeader}>
            <View style={styles.postHeaderTitleRow}>
              <Icon name="message-square" size={16} color={colors.primary} />
              <Text style={styles.postHeaderTitle}>{ANUNCIO_LABELS.postForPublish}</Text>
            </View>
            <Button
              variant="ghost"
              size="sm"
              onPress={props.onCopyPost}
              title={ANUNCIO_LABELS.ctaCopy}
              leftIcon={<Icon name="copy" size={14} color={colorScales.gray[700]} />}
            />
          </View>
          <Text style={styles.postText}>{props.postCopyDisplay}</Text>
        </Card>
      ) : null}

      <View style={styles.actionDock}>
        {!props.generating ? (
          <>
            <Button
              variant="ghost"
              size="md"
              onPress={props.onCreateAnother}
              title={ANUNCIO_LABELS.ctaCreateAnother}
              leftIcon={<Icon name="rotate-ccw" size={16} color={colorScales.gray[700]} />}
            />
            {props.result?.id ? (
              <Button
                variant="outline"
                size="md"
                onPress={props.onRegenerate}
                title={ANUNCIO_LABELS.ctaRegenerateWithCorrection}
                leftIcon={<Icon name="refresh-cw" size={16} color={colorScales.gray[700]} />}
              />
            ) : null}
            {props.result?.image_url ? (
              <Button
                variant="primary"
                size="md"
                onPress={props.onViewLibrary}
                title={ANUNCIO_LABELS.ctaViewLibrary}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  stepScroll: {
    flex: 1,
  },
  stepContent: {
    padding: spacing[4],
    gap: spacing[3],
  },
  heroCard: {
    padding: spacing[4],
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  heroIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
  },
  heroTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  heroHelper: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    lineHeight: 16,
  },
  fieldLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold as any,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colorScales.gray[700],
  },
  actionDock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    alignItems: 'center',
    marginTop: spacing[3],
  },
  generateButtonContainer: {
    marginLeft: 'auto',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  orbit: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.primary,
    borderTopColor: 'transparent',
  },
  checkCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: {
    flex: 1,
  },
  resultTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  resultSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    backgroundColor: '#fee2e2',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.error,
    flex: 1,
  },
  resultStage: {
    padding: 0,
    overflow: 'hidden',
  },
  imageStage: {
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
    backgroundColor: colorScales.gray[100],
  },
  previewImage: {
    width: '100%',
    height: 280,
  },
  imagePlaceholder: {
    alignItems: 'center',
    gap: spacing[2],
  },
  placeholderText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    textAlign: 'center',
  },
  skeletonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
  },
  skeletonText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  postCard: {
    padding: spacing[4],
    gap: spacing[3],
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
  postHeaderTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  postText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    lineHeight: 22,
  },
});
