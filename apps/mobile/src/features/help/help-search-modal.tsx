import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Modal,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';
import { HelpCenterService, HelpArticle } from '@/features/help/help.service';

interface HelpSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectArticle: (article: HelpArticle) => void;
}

export function HelpSearchModal({ visible, onClose, onSelectArticle }: HelpSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HelpArticle[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (text.trim().length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const articles = await HelpCenterService.searchArticles(text.trim(), 10);
        setResults(articles);
        setHasSearched(true);
      } catch {
        setResults([]);
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const handleSelect = useCallback((article: HelpArticle) => {
    Keyboard.dismiss();
    onSelectArticle(article);
    onClose();
  }, [onSelectArticle, onClose]);

  const handleClose = useCallback(() => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable style={styles.overlay} onPress={handleClose}>
        <View style={styles.modal} onStartShouldSetResponder={() => true}>
          {/* Search Input */}
          <View style={styles.inputWrap}>
            <Icon name="search" size={20} color={colorScales.gray[400]} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Buscar artículos de ayuda..."
              placeholderTextColor={colorScales.gray[400]}
              value={query}
              onChangeText={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => handleSearch('')} hitSlop={8}>
                <Icon name="x" size={16} color={colorScales.gray[400]} />
              </Pressable>
            )}
          </View>

          {/* Results */}
          {query.length >= 2 && (
            <View style={styles.resultsContainer}>
              {isSearching ? (
                <View style={styles.loading}>
                  <Spinner size="sm" />
                  <Text style={styles.loadingText}>Buscando...</Text>
                </View>
              ) : results.length > 0 ? (
                <FlatList
                  data={results}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={({ item }) => (
                    <Pressable
                      style={styles.resultItem}
                      onPress={() => handleSelect(item)}
                    >
                      <View style={styles.resultContent}>
                        <Text style={styles.resultTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.resultSummary} numberOfLines={1}>
                          {item.summary}
                        </Text>
                      </View>
                      <View style={styles.resultCategory}>
                        <Text style={styles.resultCategoryText}>
                          {item.category.name}
                        </Text>
                      </View>
                    </Pressable>
                  )}
                  showsVerticalScrollIndicator={false}
                />
              ) : hasSearched ? (
                <View style={styles.empty}>
                  <Icon name="search" size={24} color={colorScales.gray[300]} />
                  <Text style={styles.emptyText}>No se encontraron artículos</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Hint */}
          {query.length < 2 && (
            <View style={styles.hint}>
              <Icon name="help-circle" size={16} color={colorScales.gray[400]} />
              <Text style={styles.hintText}>
                Escribe al menos 2 caracteres para buscar
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  modal: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    ...shadows.xl,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    gap: spacing[3],
  },
  input: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colorScales.gray[900],
  },
  resultsContainer: {
    maxHeight: 300,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    gap: spacing[2],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[50],
  },
  resultContent: {
    flex: 1,
    marginRight: spacing[3],
  },
  resultTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[900],
  },
  resultSummary: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  resultCategory: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.blue[50],
  },
  resultCategoryText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.blue[600],
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[8],
    gap: spacing[2],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[5],
    gap: spacing[2],
  },
  hintText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
});
