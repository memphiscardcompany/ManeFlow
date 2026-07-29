import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Card } from '../types';
import { CARD_IMAGE_PLACEHOLDER, resolveAssetUrl } from '../services/api';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function CardRow({ card, onPress }: { card: Card; onPress?: () => void }) {
  const trend = card.market?.trend30Pct;
  const primaryUri = useMemo(() => resolveAssetUrl(card.image || CARD_IMAGE_PLACEHOLDER), [card.image]);
  const fallbackUri = useMemo(() => resolveAssetUrl(CARD_IMAGE_PLACEHOLDER), []);
  const [imageUri, setImageUri] = useState(primaryUri);
  const title = [card.year, card.brand, card.player].filter(Boolean).join(' ') || 'Trading card';
  const meta = [card.set, card.cardNumber ? `#${card.cardNumber}` : '', card.parallel].filter(Boolean).join(' - ') || card.sport || 'Catalog card';
  const grade = [card.grade?.company, card.grade?.grade].filter(Boolean).join(' ') || 'Grade not set';
  const imageSource = card.imageMeta?.placeholder
    ? 'No image source'
    : (card.imageMeta?.source || card.imageMeta?.rightsStatus || (card.image ? 'Image available' : 'No image source')).replaceAll('_', ' ');
  const trendText = trend == null ? 'Needs comps' : `${trend >= 0 ? 'Up' : 'Down'} ${Math.abs(trend).toFixed(1)}%`;

  useEffect(() => {
    setImageUri(primaryUri);
  }, [primaryUri]);

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Image source={{ uri: imageUri }} style={styles.image} onError={() => setImageUri(fallbackUri)} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <Text style={styles.meta} numberOfLines={2}>{meta}</Text>
        <View style={styles.pillRow}>
          <Text style={styles.sourcePill} numberOfLines={1}>Image: {imageSource}</Text>
          <Text style={styles.gradePill} numberOfLines={1}>{grade}</Text>
        </View>
      </View>
      <View style={styles.price}>
        <Text style={styles.priceText} numberOfLines={1} adjustsFontSizeToFit>{card.market?.value ? currency.format(card.market.value) : 'No value yet'}</Text>
        <Text style={[styles.trend, trend && trend < 0 ? styles.down : styles.up]}>{trendText}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: '#252c37', backgroundColor: '#111722' },
  image: { width: 58, height: 82, borderRadius: 8, backgroundColor: '#252c37' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#f7f2e8', fontSize: 14, fontWeight: '800' },
  meta: { color: '#98a2b3', fontSize: 11, marginTop: 3 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  sourcePill: { maxWidth: 150, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', color: '#b9d7ff', backgroundColor: '#132235', fontSize: 9, fontWeight: '800' },
  gradePill: { maxWidth: 96, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', color: '#f1cf71', backgroundColor: '#271f12', fontSize: 9, fontWeight: '800' },
  price: { alignItems: 'flex-end', width: 88 },
  priceText: { color: '#f7f2e8', fontSize: 15, fontWeight: '900', textAlign: 'right' },
  trend: { marginTop: 7, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', fontSize: 10, fontWeight: '800' },
  up: { color: '#a8f3c5', backgroundColor: '#153226' },
  down: { color: '#ffc0c0', backgroundColor: '#371f24' },
});
