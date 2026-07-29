import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { CardRow } from './src/components/CardRow';
import { api, CARD_IMAGE_PLACEHOLDER, resolveAssetUrl, setSessionToken } from './src/services/api';
import type { Card } from './src/types';

type Tab = 'home' | 'search' | 'scan' | 'lot' | 'vault' | 'sell' | 'account';
type LotUpload = { dataUrl: string; filename: string; uri: string };
type Side = 'front' | 'back' | 'cert';
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState('');
  const [query, setQuery] = useState('');
  const [dashboard, setDashboard] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [auth, setAuth] = useState<any>({ authenticated: false, user: null });
  const [config, setConfig] = useState<any>({ marketMode: 'demo', visionEnabled: false });
  const [selected, setSelected] = useState<any>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const [scanText, setScanText] = useState('');
  const [certText, setCertText] = useState('');
  const [scanMatches, setScanMatches] = useState<Card[]>([]);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [scanError, setScanError] = useState('');
  const [frontData, setFrontData] = useState('');
  const [backData, setBackData] = useState('');
  const [certData, setCertData] = useState('');
  const [captureSide, setCaptureSide] = useState<Side>('front');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const cardsRequestRef = useRef(0);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [lotImages, setLotImages] = useState<LotUpload[]>([]);
  const [lotUrl, setLotUrl] = useState('');
  const [lotPrice, setLotPrice] = useState('');
  const [lotShipping, setLotShipping] = useState('0');
  const [lotTax, setLotTax] = useState('0');
  const [lotTargetRoi, setLotTargetRoi] = useState('25');
  const [lotResult, setLotResult] = useState<any>(null);
  const [lotError, setLotError] = useState('');
  const [lotLoading, setLotLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [accountMode, setAccountMode] = useState<'login' | 'register'>('login');

  async function refreshCards(q = '') {
    const requestId = ++cardsRequestRef.current;
    setLoading(true);
    setSearchError('');
    try {
      const result = await api<{ cards: Card[] }>(`/api/cards?q=${encodeURIComponent(q)}&limit=50`);
      if (requestId === cardsRequestRef.current) setCards(result.cards);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load cards';
      if (requestId === cardsRequestRef.current) {
        setSearchError(message);
        if (tab !== 'search') Alert.alert('ManeFlow', message);
      }
    } finally {
      if (requestId === cardsRequestRef.current) setLoading(false);
    }
  }

  async function refreshDashboard() {
    try { setDashboard(await api('/api/dashboard')); }
    catch { setDashboard(null); }
  }

  async function refreshIdentity() {
    try { setAuth(await api('/api/auth/me')); }
    catch { setAuth({ authenticated: false, user: null }); }
  }

  async function refreshAll() {
    await Promise.all([
      refreshCards(), refreshDashboard(), refreshIdentity(),
      api('/api/config').then(setConfig).catch(() => {}),
    ]);
  }

  useEffect(() => { refreshAll(); }, []);
  useEffect(() => {
    if (tab === 'vault' || tab === 'home') refreshDashboard();
    if (tab === 'sell') api<{ listings: any[] }>('/api/listings').then((data) => setListings(data.listings)).catch(() => setListings([]));
    if (tab === 'account') refreshIdentity();
    if (tab !== 'scan') setCameraOpen(false);
  }, [tab]);
  useEffect(() => {
    if (tab !== 'search') return undefined;
    const timer = setTimeout(() => { refreshCards(query); }, 220);
    return () => clearTimeout(timer);
  }, [query, tab]);

  const featured = useMemo(() => cards.slice(0, 6), [cards]);

  async function openCard(card: Card) {
    setSelectedLoading(true);
    setSelected({ card });
    try {
      const [market, dealer] = await Promise.all([
        api<any>(`/api/cards/${encodeURIComponent(card.id)}/market?window=365d`),
        api<any>(`/api/cards/${encodeURIComponent(card.id)}/dealer-decision`).catch(() => null),
      ]);
      setSelected({ ...market, dealerDecision: dealer?.decision || null, dealerMarketMode: dealer?.marketMode || market.marketMode });
    }
    catch (error) { Alert.alert('Market data', error instanceof Error ? error.message : 'Unable to load card'); setSelected(null); }
    finally { setSelectedLoading(false); }
  }

  async function identify() {
    if (!frontData && !certData && !scanText.trim() && !certText.trim()) return Alert.alert('Add a card', 'Capture or choose a card or cert-label image, or enter visible card/cert details.');
    setLoading(true);
    setScanError('');
    try {
      const result = await api<{ matches: Card[]; message: string; scanConfidence?: any; gradedCert?: any; recognition?: any; marketMode?: string }>('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ frontDataUrl: frontData, backDataUrl: backData, certDataUrl: certData, imageName: certData && !frontData ? 'native-cert-label.jpg' : 'native-scan.jpg', manualText: scanText, certText, barcodeText: certText, qrText: certText }),
      });
      setScanMatches(result.matches);
      setScanMeta({ scanConfidence: result.scanConfidence, gradedCert: result.gradedCert, recognition: result.recognition, marketMode: result.marketMode, message: result.message });
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Unable to identify card');
    } finally { setLoading(false); }
  }

  async function pickPhoto(side: Side) {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, base64: true, mediaTypes: ['images'] });
    if (!result.canceled) {
      const asset = result.assets[0];
      const mime = asset?.mimeType || 'image/jpeg';
      const dataUrl = asset?.base64 ? `data:${mime};base64,${asset.base64}` : '';
      if (side === 'front') setFrontData(dataUrl);
      else if (side === 'back') setBackData(dataUrl);
      else setCertData(dataUrl);
    }
  }

  async function pickLotImages() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.82,
        base64: true,
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 30,
      });
      if (result.canceled) return;
      const uploads = result.assets
        .filter((asset) => asset.base64)
        .map((asset, index) => ({
          dataUrl: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`,
          filename: asset.fileName || `lot-${index + 1}.jpg`,
          uri: asset.uri,
        }));
      setLotImages(uploads);
      setLotResult(null);
      setLotError('');
    } catch (error) {
      Alert.alert('Lot photos', error instanceof Error ? error.message : 'Unable to choose lot photos');
    }
  }

  async function analyzeLot() {
    if (!lotImages.length && !lotUrl.trim()) return Alert.alert('Add a lot', 'Paste an eBay URL or choose listing photos.');
    const listingPrice = Number(lotPrice || 0);
    const inboundShipping = Number(lotShipping || 0);
    const salesTax = Number(lotTax || 0);
    if ([listingPrice, inboundShipping, salesTax].some((value) => !Number.isFinite(value) || value < 0)) return Alert.alert('Lot costs', 'BIN, shipping, and tax must be valid non-negative numbers.');
    setLotLoading(true);
    setLotError('');
    setLotResult(null);
    try {
      const targetRoi = Number(lotTargetRoi || 25) / 100;
      const result = lotImages.length
        ? await api<any>('/api/vision/lot-analyze', {
          method: 'POST',
          body: JSON.stringify({
            images: lotImages.map(({ dataUrl, filename }) => ({ dataUrl, filename })),
            listingPrice,
            inboundShipping,
            salesTax,
            sourceType: lotUrl.trim() ? 'ebay_listing_upload' : 'mobile_upload',
            sourceUrl: lotUrl.trim() || null,
            marketplaceFeeRate: 0.1325,
            outboundShippingPerItem: 0,
            targetRoi,
          }),
        })
        : await api<any>('/api/vision/lot-analyze-ebay', {
          method: 'POST',
          body: JSON.stringify({
            sourceUrl: lotUrl.trim(),
            listingPriceOverride: lotPrice.trim() ? listingPrice : null,
            inboundShippingOverride: lotShipping.trim() ? inboundShipping : null,
            salesTax,
            marketplaceFeeRate: 0.1325,
            outboundShippingPerItem: 0,
            targetRoi,
          }),
        });
      setLotResult(result);
    } catch (error) {
      setLotError(error instanceof Error ? error.message : 'Unable to analyze lot');
    } finally {
      setLotLoading(false);
    }
  }

  async function capturePhoto() {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.85, base64: true, skipProcessing: false });
      const dataUrl = photo?.base64 ? `data:image/jpeg;base64,${photo.base64}` : '';
      if (captureSide === 'front') setFrontData(dataUrl);
      else if (captureSide === 'back') setBackData(dataUrl);
      else setCertData(dataUrl);
      setCaptureSide(captureSide === 'front' ? 'back' : captureSide === 'back' ? 'cert' : 'front');
    } catch (error) { Alert.alert('Camera', error instanceof Error ? error.message : 'Unable to capture photo'); }
  }

  async function addSelectedToVault() {
    if (!selected?.card?.id) return;
    try {
      await api('/api/collection', { method: 'POST', body: JSON.stringify({ cardId: selected.card.id, name: `${selected.card.year} ${selected.card.brand} ${selected.card.player}`, quantity: 1 }) });
      Alert.alert('Added', 'Card added to your Vault.');
      refreshDashboard();
    } catch (error) { Alert.alert('Vault', error instanceof Error ? error.message : 'Unable to add card'); }
  }

  async function createWatch() {
    if (!selected?.card?.id) return;
    try {
      await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ cardId: selected.card.id, targetPrice: selected.valuation?.value, direction: 'below' }) });
      Alert.alert('Watching', 'Price alert created at the current estimated value.');
    } catch (error) { Alert.alert('Watchlist', error instanceof Error ? error.message : 'Unable to create alert'); }
  }

  async function submitAccount() {
    try {
      const path = accountMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const result = await api<any>(path, { method: 'POST', body: JSON.stringify({ name, email, password, native: true }) });
      if (!result.sessionToken) throw new Error('Server did not return a native session token.');
      await setSessionToken(result.sessionToken);
      setAuth({ authenticated: true, user: result.user });
      setPassword('');
      await refreshDashboard();
      setTab('home');
    } catch (error) { Alert.alert('Account', error instanceof Error ? error.message : 'Unable to continue'); }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    await setSessionToken('');
    setAuth({ authenticated: false, user: null });
    setDashboard(null);
  }

  async function forgotPassword() {
    if (!email.trim()) return Alert.alert('Password reset', 'Enter your email address first.');
    try {
      const result = await api<any>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      Alert.alert('Password reset', result.message || 'Instructions have been queued.');
    } catch (error) { Alert.alert('Password reset', error instanceof Error ? error.message : 'Unable to request a reset'); }
  }

  async function requestVerification() {
    try {
      const result = await api<any>('/api/auth/request-verification', { method: 'POST', body: '{}' });
      Alert.alert('Email verification', result.message || 'Verification instructions have been queued.');
    } catch (error) { Alert.alert('Email verification', error instanceof Error ? error.message : 'Unable to request verification'); }
  }

  function scoreTone(value: number) {
    if (value >= 78) return '#50e3a4';
    if (value >= 55) return '#f1cf71';
    return '#ff8f8f';
  }

  function imageSourceLabel(card?: Card) {
    if (!card) return 'No image source';
    const meta = card.imageMeta;
    if (meta?.placeholder) return 'No image source';
    return String(meta?.source || meta?.rightsStatus || (card.image ? 'Image available' : 'No image source')).replaceAll('_', ' ');
  }

  function InlineState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
    return <View style={styles.stateBox}><Text style={styles.sourceTitle}>{title}</Text><Text style={styles.body}>{body}</Text>{action}</View>;
  }

  function LoadingBlock({ label = 'Loading card intelligence...' }: { label?: string }) {
    return <View style={styles.loadingBox}><ActivityIndicator color="#f1cf71" /><Text style={styles.body}>{label}</Text></View>;
  }

  function CapturePill({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
    return <View style={[styles.capturePill, ready && styles.captureReady]}><Text style={styles.capturePillText}>{label}</Text><Text style={styles.capturePillDetail}>{ready ? 'Ready' : detail}</Text></View>;
  }

  function ScanTrustCard({ meta }: { meta: any }) {
    const scan = meta?.scanConfidence;
    const cert = meta?.gradedCert;
    const recognition = meta?.recognition;
    if (!scan && !cert && !meta?.message) return null;
    const scanScore = Math.round(Number(scan?.scanConfidenceScore || 0));
    const warnings = scan?.warnings || [];
    const parallelUncertain = warnings.some((warning: string) => warning.toLowerCase().includes('parallel'));
    const scene = recognition?.scene;
    const summary = recognition?.summary;
    return <View style={styles.trustCard}>
      <View style={styles.trustHeader}><Text style={styles.eyebrow}>SCAN TRUST</Text><Text style={[styles.trustScore, { color: scoreTone(scanScore) }]}>{scanScore}%</Text></View>
      <Text style={styles.sourceTitle}>{scan?.needsManualConfirmation ? 'Confirm before acting' : 'Ready for review'}</Text>
      <Text style={styles.body}>{meta?.message || scan?.recommendedNextStep || 'Confirm identity, condition, parallel, grade, and cert before transacting.'}</Text>
      <View style={styles.pillRowWrap}>
        <Text style={[styles.infoPill, scan?.needsManualConfirmation && styles.warnPill]}>{scan?.needsManualConfirmation ? 'Needs better scan or confirmation' : 'Why this match ready'}</Text>
        {parallelUncertain ? <Text style={[styles.infoPill, styles.warnPill]}>Parallel uncertain</Text> : null}
        <Text style={styles.infoPill}>Cert status: {cert?.slabbed ? 'parsed' : 'not detected'}</Text>
        {recognition?.scene ? <Text style={styles.infoPill}>Scene: {String(scene?.type || 'single_card').replaceAll('_', ' ')}</Text> : null}
        {recognition?.summary ? <Text style={[styles.infoPill, Number(summary?.needsConfirmation || 0) ? styles.warnPill : null]}>{summary?.detectedCards || 0} detected / {summary?.matchedCards || 0} matched</Text> : null}
      </View>
      {cert?.slabbed ? <View style={styles.certBox}><Text style={styles.status}>GRADED CERT INTELLIGENCE</Text><Text style={styles.sourceTitle}>{cert.gradeLabel || `${cert.grader || ''} ${cert.grade || ''}`.trim() || 'Slab detected'}</Text><Text style={styles.body}>Cert {cert.certNumber || 'not confirmed'} · {Math.round(Number(cert.certConfidence || 0))}% confidence</Text></View> : null}
      {(scan?.warnings || []).slice(0, 4).map((warning: string) => <Text key={warning} style={styles.warningText}>• {warning}</Text>)}
    </View>;
  }

  function ValueTrustCard({ valuation, decision }: { valuation: any; decision: any }) {
    const compQuality = valuation?.compQuality || {};
    return <View style={styles.trustCard}>
      <View style={styles.trustHeader}><Text style={styles.eyebrow}>WHY THIS VALUE</Text><Text style={[styles.trustScore, { color: scoreTone(Number(valuation?.confidence || 0)) }]}>{valuation?.confidence || 0}%</Text></View>
      <Text style={styles.body}>{compQuality.includedCount || 0} included comps · {compQuality.excludedCount || 0} excluded · {compQuality.needsReviewCount || 0} need review</Text>
      {decision ? <View style={styles.dealerBox}><Text style={styles.status}>MERCHANT PRICING CENTER</Text><Text style={styles.sourceTitle}>{decision.suggestedAction || 'Review before buying'}</Text><Text style={styles.body}>Buy {currency.format(decision.dealerBuyRange?.low || 0)}-{currency.format(decision.dealerBuyRange?.high || 0)} · List {currency.format(decision.fairListPrice || 0)}</Text></View> : <Text style={styles.body}>Merchant and Enterprise accounts unlock buy targets, list guidance, offer sheets, and shop actions.</Text>}
    </View>;
  }

  function Header() {
    return <View style={styles.header}><View style={styles.logo}><Text style={styles.logoText}>M</Text></View><View style={{ flex: 1 }}><Text style={styles.brand}>ManeFlow</Text><Text style={styles.brandSub}>CARD INTELLIGENCE</Text></View><View style={[styles.modePill, config.marketMode === 'production' && styles.modeLive]}><Text style={styles.modeText}>{String(config.marketMode).toUpperCase()}</Text></View></View>;
  }

  function Home() {
    const portfolio = dashboard?.portfolio || { totalValue: 0, totalCost: 0, totalGain: 0, estimatedLiquidValue: 0 };
    const decisionSummary = dashboard?.intelligence?.decisionSupport?.summary;
    return <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.notice}><Text style={styles.noticeText}>{config.marketMode === 'production' ? 'Approved live data connected. Confirm identity and source details before transacting.' : 'Demonstration or mixed data is enabled. Connect approved feeds before public value claims.'}</Text></View>
      <View style={styles.hero}><Text style={styles.eyebrow}>THE CARD DECISION ENGINE</Text><Text style={styles.heroTitle}>Scan it.{`\n`}Know it. Act.</Text><Text style={styles.body}>Identification, completed-sale intelligence, collection performance, alerts, and selling decisions in one native workflow.</Text><View style={styles.buttonRow}><Pressable style={styles.primaryButton} onPress={() => setTab('scan')}><Text style={styles.primaryText}>Scan a card</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => setTab('lot')}><Text style={styles.secondaryText}>Analyze a lot</Text></Pressable></View></View>
      <View style={styles.metrics}><Metric label="Collection" value={currency.format(portfolio.totalValue)} /><Metric label="Cost basis" value={currency.format(portfolio.totalCost)} /><Metric label="Gain" value={currency.format(portfolio.totalGain)} /><Metric label="Liquid value" value={currency.format(portfolio.estimatedLiquidValue)} /></View>
      {decisionSummary ? <View style={styles.metrics}><Metric label="Sell now" value={String(decisionSummary.sellNow || 0)} /><Metric label="Hold" value={String(decisionSummary.hold || 0)} /><Metric label="Watch" value={String(decisionSummary.watch || 0)} /><Metric label="Review" value={String(decisionSummary.review || 0)} /></View> : null}
      <Text style={styles.sectionTitle}>Market pulse</Text><View style={styles.list}>{loading && !featured.length ? <LoadingBlock label="Loading market pulse..." /> : featured.length ? featured.map((card) => <CardRow key={card.id} card={card} onPress={() => openCard(card)} />) : <InlineState title="No market pulse yet" body="Connect approved completed-sale data or load a larger catalog to populate cards moving now." />}</View>
    </ScrollView>;
  }

  function Search() {
    return <View style={styles.content}><Text style={styles.eyebrow}>UNIVERSAL LOOKUP</Text><Text style={styles.title}>Search cards</Text><TextInput value={query} onChangeText={setQuery} placeholder="Player, year, set, number, parallel..." placeholderTextColor="#657083" style={styles.input} />{searchError ? <InlineState title="Search could not finish" body={searchError} /> : loading ? <LoadingBlock label="Searching catalog and pricing context..." /> : cards.length ? <FlatList data={cards} keyExtractor={(item) => item.id} renderItem={({ item }) => <CardRow card={item} onPress={() => openCard(item)} />} contentContainerStyle={styles.list} /> : <InlineState title="No exact catalog match" body="Try fewer details, scan the card, or import more checklist data. ManeFlow will not invent a card identity." action={<Pressable style={styles.secondaryButton} onPress={() => setTab('scan')}><Text style={styles.secondaryText}>Use camera scan</Text></Pressable>} />}</View>;
  }

  function Scan() {
    return <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView><Text style={styles.eyebrow}>FRONT + BACK LOOKUP</Text><Text style={styles.title}>Scan a card</Text>
      {cameraOpen ? <View style={styles.cameraWrap}><CameraView ref={cameraRef} style={styles.camera} facing="back" /><View style={styles.scanFrame} /><Text style={styles.captureLabel}>CAPTURING {captureSide.toUpperCase()}</Text></View> : <View style={[styles.cameraWrap, styles.cameraEmpty]}><Text style={styles.body}>Start the rear camera or choose front, back, and cert-label images.</Text></View>}
      <View style={styles.captureStatus}><CapturePill label="Front" ready={Boolean(frontData)} detail="Needed" /><CapturePill label="Back" ready={Boolean(backData)} detail="Recommended" /><CapturePill label="Cert" ready={Boolean(certData || certText.trim())} detail="If graded" /></View>
      <View style={styles.buttonRow}><Pressable style={styles.primaryButton} onPress={async () => { if (!cameraPermission?.granted) await requestCameraPermission(); setCameraOpen(true); }}><Text style={styles.primaryText}>Start camera</Text></Pressable>{cameraOpen ? <Pressable style={styles.secondaryButton} onPress={capturePhoto}><Text style={styles.secondaryText}>Capture {captureSide}</Text></Pressable> : null}</View>
      <View style={styles.buttonRow}><Pressable style={styles.secondaryButton} onPress={() => pickPhoto('front')}><Text style={styles.secondaryText}>{frontData ? 'Front ready' : 'Choose front'}</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => pickPhoto('back')}><Text style={styles.secondaryText}>{backData ? 'Back ready' : 'Choose back'}</Text></Pressable></View>
      <View style={styles.buttonRow}><Pressable style={styles.secondaryButton} onPress={() => pickPhoto('cert')}><Text style={styles.secondaryText}>{certData ? 'Cert label ready' : 'Choose cert label'}</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => setCaptureSide('cert')}><Text style={styles.secondaryText}>Capture cert next</Text></Pressable></View>
      <TextInput value={scanText} onChangeText={setScanText} multiline placeholder="Visible text: 2018 Topps Update Shohei Ohtani US1 PSA 10" placeholderTextColor="#657083" style={[styles.input, styles.textarea]} />
      <TextInput value={certText} onChangeText={setCertText} multiline placeholder="Cert/barcode: PSA Cert #12345678 or official cert URL" placeholderTextColor="#657083" style={[styles.input, styles.certInput]} />
      <Pressable style={styles.primaryButton} onPress={identify}><Text style={styles.primaryText}>{loading ? 'Analyzing...' : 'Identify and price'}</Text></Pressable>
      {loading ? <LoadingBlock label="Checking image quality, cert evidence, catalog candidates, and completed-sale value..." /> : null}
      {scanError ? <InlineState title="Scan could not finish" body={scanError} action={<Pressable style={styles.secondaryButton} onPress={() => { setScanError(''); setScanMeta(null); }}><Text style={styles.secondaryText}>Clear and retry</Text></Pressable>} /> : null}
      <ScanTrustCard meta={scanMeta} />
      <View style={styles.list}>{scanMatches.length ? scanMatches.map((card) => <CardRow key={card.id} card={card} onPress={() => openCard(card)} />) : scanMeta && !loading && !scanError ? <InlineState title="No catalog match yet" body="Add a back image, cert label, or visible text. ManeFlow will not guess when identity is uncertain." /> : null}</View>
      <Text style={styles.noticeText}>Confirm card number, parallel, grade, cert, and condition before using any value.</Text></ScrollView></KeyboardAvoidingView>;
  }

  function Lot() {
    const economics = lotResult?.economics || null;
    const representatives = new Map<string, any>();
    for (const source of lotResult?.images || []) {
      for (const item of source.detections || []) {
        const key = item.physical_item_group || item.item_id;
        const current = representatives.get(key);
        if (!current || Number(item.detection_confidence || 0) > Number(current.detection_confidence || 0)) representatives.set(key, item);
      }
    }
    const items = [...representatives.values()].filter((item) => item.evidence?.is_trading_card !== false);
    return <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView>
      <Text style={styles.eyebrow}>EBAY + MIXED CARD LOTS</Text><Text style={styles.title}>Analyze a lot</Text>
      <Text style={styles.body}>Use an eBay URL with an authorized connection, or choose every listing photo. ManeFlow detects visible cards, reconciles repeated views, prices verified identities, and compares the lot with the asking price.</Text>
      <TextInput value={lotUrl} onChangeText={setLotUrl} autoCapitalize="none" keyboardType="url" placeholder="eBay listing URL (optional)" placeholderTextColor="#657083" style={styles.input} />
      <Pressable style={styles.secondaryButton} onPress={pickLotImages}><Text style={styles.secondaryText}>{lotImages.length ? `${lotImages.length} photos ready` : 'Choose listing photos'}</Text></Pressable>
      {lotImages.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.lotPhotoStrip}>{lotImages.map((image, index) => <Image key={`${image.filename}-${index}`} source={{ uri: image.uri }} style={styles.lotPhoto} />)}</ScrollView> : null}
      <View style={styles.buttonRow}><TextInput value={lotPrice} onChangeText={setLotPrice} keyboardType="decimal-pad" placeholder="BIN price" placeholderTextColor="#657083" style={[styles.input, styles.flexInput]} /><TextInput value={lotShipping} onChangeText={setLotShipping} keyboardType="decimal-pad" placeholder="Shipping" placeholderTextColor="#657083" style={[styles.input, styles.flexInput]} /></View>
      <View style={styles.buttonRow}><TextInput value={lotTax} onChangeText={setLotTax} keyboardType="decimal-pad" placeholder="Tax" placeholderTextColor="#657083" style={[styles.input, styles.flexInput]} /><TextInput value={lotTargetRoi} onChangeText={setLotTargetRoi} keyboardType="decimal-pad" placeholder="Target ROI %" placeholderTextColor="#657083" style={[styles.input, styles.flexInput]} /></View>
      <Pressable style={styles.primaryButton} onPress={analyzeLot} disabled={lotLoading}><Text style={styles.primaryText}>{lotLoading ? 'Detecting and pricing...' : 'Analyze lot opportunity'}</Text></Pressable>
      {lotLoading ? <LoadingBlock label="Separating card objects, reconciling repeated angles, checking identities and verified pricing..." /> : null}
      {lotError ? <InlineState title="Lot analysis could not finish" body={lotError} /> : null}
      {economics ? <View style={styles.trustCard}><Text style={styles.eyebrow}>LOT DECISION</Text><Text style={styles.title}>{String(economics.decision || 'Review required').replaceAll('_', ' ')}</Text><View style={styles.metrics}><Metric label="Acquisition" value={currency.format(Number(economics.acquisition_total || 0))} /><Metric label="Gross value" value={economics.expected_gross_value == null ? 'Unpriced' : currency.format(Number(economics.expected_gross_value))} /><Metric label="Profit" value={economics.expected_profit == null ? '—' : currency.format(Number(economics.expected_profit))} /><Metric label="Max buy" value={economics.recommended_max_purchase == null ? '—' : currency.format(Number(economics.recommended_max_purchase))} /></View><Text style={styles.body}>{economics.explanation}</Text><Text style={styles.status}>{items.length} physical cards · {economics.priced_items || 0} priced · {economics.unresolved_items || 0} unresolved</Text></View> : null}
      <View style={styles.list}>{items.map((item, index) => { const card = item.predicted_card || {}; const title = [card.year, card.brand, card.set_name, card.player_name].filter(Boolean).join(' ') || 'Unresolved card'; return <View key={item.physical_item_group || item.item_id || index} style={styles.source}><Text style={styles.sourceTitle}>{index + 1}. {title}</Text><Text style={styles.body}>{[card.card_number ? `#${card.card_number}` : '', card.parallel, card.grader, card.grade].filter(Boolean).join(' · ') || 'Exact variant needs confirmation'}</Text><Text style={styles.priceText}>{item.value_mid == null ? 'No verified price' : currency.format(Number(item.value_mid))}</Text><Text style={styles.status}>Identity {Math.round(Number(item.identity_confidence || 0) * 100)}% · Variant {Math.round(Number(item.variant_confidence || 0) * 100)}%</Text></View>; })}</View>
      <Text style={styles.noticeText}>Listing photos cannot prove condition, authenticity, exact parallel, or hidden cards. Confirm unresolved items before purchasing.</Text>
    </ScrollView></KeyboardAvoidingView>;
  }

  function Vault() {
    const collection = dashboard?.collection || [];
    const portfolio = dashboard?.portfolio || { totalValue: 0, totalCost: 0, totalGain: 0, estimatedLiquidValue: 0 };
    return <ScrollView contentContainerStyle={styles.content}><Text style={styles.eyebrow}>PRIVATE PORTFOLIO</Text><Text style={styles.title}>My Vault</Text><View style={styles.metrics}><Metric label="Value" value={currency.format(portfolio.totalValue)} /><Metric label="Cost" value={currency.format(portfolio.totalCost)} /><Metric label="Gain" value={currency.format(portfolio.totalGain)} /><Metric label="Liquid" value={currency.format(portfolio.estimatedLiquidValue)} /></View><View style={styles.list}>{collection.length ? collection.map((item: any) => item.card ? <CardRow key={item.id} card={{ ...item.card, market: item.market }} onPress={() => openCard(item.card)} /> : <View key={item.id} style={styles.source}><Text style={styles.sourceTitle}>{item.name || 'Unmatched card'}</Text><Text style={styles.body}>Qty {item.quantity || 1}. Needs catalog match before ManeFlow can value it confidently.</Text><Text style={styles.status}>Manual review</Text></View>) : <InlineState title="Your Vault is empty" body="Scan or search for a card, then add it to begin tracking value, liquidity, confidence, and portfolio movement." action={<Pressable style={styles.primaryButton} onPress={() => setTab('scan')}><Text style={styles.primaryText}>Scan first card</Text></Pressable>} />}</View></ScrollView>;
  }

  function Sell() {
    return <ScrollView contentContainerStyle={styles.content}><Text style={styles.eyebrow}>INTELLIGENCE TO REVENUE</Text><Text style={styles.title}>Selling workspace</Text><Text style={styles.noticeText}>ManeFlow prepares pricing and drafts. Marketplace submission requires your explicit action and an authorized connection.</Text><View style={styles.list}>{listings.length ? listings.map((item) => <View key={item.id} style={styles.source}><Text style={styles.sourceTitle}>{item.title || 'Untitled listing'}</Text><Text style={styles.status}>{item.marketplace} · {item.status}</Text><Text style={styles.priceText}>{item.price == null ? 'No price' : currency.format(item.price)}</Text></View>) : <Text style={styles.body}>Open a card, then create listing drafts from the market detail screen.</Text>}</View></ScrollView>;
  }

  function Account() {
    if (auth.authenticated) return <ScrollView contentContainerStyle={styles.content}><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.title}>{auth.user?.name}</Text><View style={styles.source}><Text style={styles.sourceTitle}>{auth.user?.email}</Text><Text style={styles.status}>{auth.user?.role} · {auth.user?.plan} plan</Text><Text style={styles.body}>{auth.user?.emailVerifiedAt ? 'Email verified' : 'Email not verified'}</Text></View>{!auth.user?.emailVerifiedAt ? <Pressable style={styles.primaryButton} onPress={requestVerification}><Text style={styles.primaryText}>Send verification email</Text></Pressable> : null}<View style={styles.source}><Text style={styles.sourceTitle}>Price alerts</Text><Text style={styles.body}>{dashboard?.unreadAlerts || 0} unread · {dashboard?.alerts?.length || 0} active</Text></View><Pressable style={styles.secondaryButton} onPress={logout}><Text style={styles.secondaryText}>Sign out</Text></Pressable></ScrollView>;
    return <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView><Text style={styles.eyebrow}>PRIVATE SYNC</Text><Text style={styles.title}>{accountMode === 'login' ? 'Sign in' : 'Create account'}</Text>{accountMode === 'register' ? <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor="#657083" style={styles.input} /> : null}<TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#657083" style={styles.input} /><TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password (10+ characters)" placeholderTextColor="#657083" style={styles.input} /><Pressable style={styles.primaryButton} onPress={submitAccount}><Text style={styles.primaryText}>{accountMode === 'login' ? 'Sign in' : 'Create account'}</Text></Pressable>{accountMode === 'login' ? <Pressable style={styles.secondaryButton} onPress={forgotPassword}><Text style={styles.secondaryText}>Forgot password</Text></Pressable> : null}<Pressable style={styles.secondaryButton} onPress={() => setAccountMode(accountMode === 'login' ? 'register' : 'login')}><Text style={styles.secondaryText}>{accountMode === 'login' ? 'Create a new account' : 'I already have an account'}</Text></Pressable></ScrollView></KeyboardAvoidingView>;
  }

  const screen = tab === 'home' ? <Home /> : tab === 'search' ? <Search /> : tab === 'scan' ? <Scan /> : tab === 'lot' ? <Lot /> : tab === 'vault' ? <Vault /> : tab === 'sell' ? <Sell /> : <Account />;
  return <SafeAreaView style={styles.safe}><StatusBar style="light" /><Header /><View style={styles.screen}>{screen}</View><View style={styles.tabs}>{(['home','search','scan','lot','vault','sell','account'] as Tab[]).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item === 'account' ? 'Me' : item.charAt(0).toUpperCase() + item.slice(1)}</Text></Pressable>)}</View>
    <Modal visible={Boolean(selected)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}><SafeAreaView style={styles.safe}>{selectedLoading ? <ActivityIndicator color="#f1cf71" style={{ marginTop: 60 }} /> : selected?.card ? <ScrollView contentContainerStyle={styles.content}><Pressable onPress={() => setSelected(null)}><Text style={styles.close}>Close</Text></Pressable><Image source={{ uri: resolveAssetUrl(selected.card.image || CARD_IMAGE_PLACEHOLDER) }} style={styles.detailImage} /><Text style={styles.eyebrow}>{selected.card.sport}</Text><Text style={styles.title}>{selected.card.year} {selected.card.brand} {selected.card.player}</Text><Text style={styles.body}>{selected.card.set} #{selected.card.cardNumber} · {selected.card.parallel} · {selected.card.grade?.company} {selected.card.grade?.grade}</Text><Text style={styles.detailPrice}>{selected.valuation?.value == null ? '—' : currency.format(selected.valuation.value)}</Text><Text style={styles.body}>Expected range {currency.format(selected.valuation?.range?.low || 0)}–{currency.format(selected.valuation?.range?.high || 0)} · {selected.valuation?.confidence || 0}% confidence · {selected.valuation?.volume90 || 0} comps/90d</Text><ValueTrustCard valuation={selected.valuation} decision={selected.dealerDecision} /><View style={styles.buttonRow}><Pressable style={styles.primaryButton} onPress={addSelectedToVault}><Text style={styles.primaryText}>Add to Vault</Text></Pressable><Pressable style={styles.secondaryButton} onPress={createWatch}><Text style={styles.secondaryText}>Watch</Text></Pressable></View><Text style={styles.noticeText}>{selected.valuation?.disclaimer}</Text></ScrollView> : null}</SafeAreaView></Modal>
  </SafeAreaView>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080b10' }, screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#202732' },
  logo: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cba548', backgroundColor: '#171b22' }, logoText: { color: '#f1cf71', fontSize: 20, fontWeight: '900' },
  brand: { color: '#f7f2e8', fontWeight: '900', fontSize: 17 }, brandSub: { color: '#98a2b3', fontSize: 9, letterSpacing: 1.2 },
  modePill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: '#302615', borderWidth: 1, borderColor: '#634d22' }, modeLive: { backgroundColor: '#123025', borderColor: '#255d46' }, modeText: { color: '#f1cf71', fontSize: 8, fontWeight: '900' },
  content: { flexGrow: 1, padding: 16, paddingBottom: 28 }, hero: { padding: 22, borderRadius: 26, borderWidth: 1, borderColor: '#493d22', backgroundColor: '#111722', marginTop: 12 },
  eyebrow: { color: '#f1cf71', fontSize: 10, fontWeight: '900', letterSpacing: 1.8, marginBottom: 7 }, heroTitle: { color: '#f7f2e8', fontSize: 39, lineHeight: 41, fontWeight: '900', letterSpacing: -1.8 },
  title: { color: '#f7f2e8', fontSize: 28, fontWeight: '900', marginBottom: 14 }, sectionTitle: { color: '#f7f2e8', fontSize: 22, fontWeight: '900', marginTop: 24, marginBottom: 12 }, body: { color: '#98a2b3', lineHeight: 20, marginTop: 10 },
  primaryButton: { minHeight: 48, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d9ae4b', marginTop: 14, flex: 1 }, primaryText: { color: '#171108', fontWeight: '900' },
  secondaryButton: { minHeight: 48, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#303846', backgroundColor: '#161e2b', marginTop: 14, flex: 1 }, secondaryText: { color: '#f7f2e8', fontWeight: '800' }, buttonRow: { flexDirection: 'row', gap: 10 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }, metric: { width: '47%', flexGrow: 1, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: '#252c37', backgroundColor: '#111722' }, metricLabel: { color: '#98a2b3', fontSize: 11 }, metricValue: { color: '#f7f2e8', fontSize: 21, fontWeight: '900', marginTop: 6 },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#2d3542', backgroundColor: '#0b1018', color: '#f7f2e8', paddingHorizontal: 13, marginBottom: 12 }, textarea: { minHeight: 100, paddingTop: 12, textAlignVertical: 'top', marginTop: 14 }, certInput: { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' }, list: { gap: 11, paddingTop: 12, paddingBottom: 28 },
  cameraWrap: { height: 420, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#594a27', position: 'relative' }, camera: { flex: 1 }, cameraEmpty: { alignItems: 'center', justifyContent: 'center', padding: 30, backgroundColor: '#111722' }, scanFrame: { position: 'absolute', left: '10%', right: '10%', top: '12%', bottom: '12%', borderWidth: 2, borderColor: '#f1cf71', borderRadius: 22 }, captureLabel: { position: 'absolute', bottom: 18, alignSelf: 'center', color: '#f1cf71', fontSize: 10, fontWeight: '900', backgroundColor: '#080b10cc', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  notice: { padding: 13, borderRadius: 14, borderWidth: 1, borderColor: '#493d22', backgroundColor: '#18150f' }, noticeText: { color: '#d8caa4', lineHeight: 19, marginTop: 14 },
  stateBox: { padding: 18, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: '#394456', backgroundColor: '#101620', marginTop: 12 },
  loadingBox: { padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#2b3544', backgroundColor: '#101620', marginTop: 12, alignItems: 'center', gap: 8 },
  captureStatus: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  capturePill: { flexGrow: 1, minWidth: 92, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: '#55451f', backgroundColor: '#18150f' },
  captureReady: { borderColor: '#2f6b4a', backgroundColor: '#10261c' },
  capturePillText: { color: '#f7f2e8', fontSize: 11, fontWeight: '900' },
  capturePillDetail: { color: '#98a2b3', fontSize: 10, marginTop: 3, textTransform: 'uppercase' },
  source: { padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#252c37', backgroundColor: '#111722' }, sourceTitle: { color: '#f7f2e8', fontWeight: '900' }, status: { color: '#f1cf71', fontSize: 10, textTransform: 'uppercase', marginTop: 5 }, priceText: { color: '#f7f2e8', fontSize: 18, fontWeight: '900', marginTop: 10 },
  trustCard: { marginTop: 14, padding: 15, borderRadius: 18, borderWidth: 1, borderColor: '#394456', backgroundColor: '#111722' },
  trustHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  trustScore: { fontSize: 24, fontWeight: '900' },
  pillRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  infoPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', color: '#b9d7ff', backgroundColor: '#132235', fontSize: 10, fontWeight: '800' },
  warnPill: { color: '#f1cf71', backgroundColor: '#302615' },
  certBox: { marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#433720', backgroundColor: '#17150f' },
  dealerBox: { marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#294736', backgroundColor: '#101a16' },
  warningText: { color: '#f0b6a5', lineHeight: 19, marginTop: 6 },
  tabs: { flexDirection: 'row', padding: 7, borderTopWidth: 1, borderTopColor: '#202732', backgroundColor: '#0c1017' }, tab: { flex: 1, minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, tabActive: { backgroundColor: '#241e12' }, tabText: { color: '#7f899a', fontSize: 9, fontWeight: '700' }, tabTextActive: { color: '#f1cf71' },
  lotPhotoStrip: { marginTop: 12, marginBottom: 12 }, lotPhoto: { width: 112, height: 84, borderRadius: 12, marginRight: 9, backgroundColor: '#111722' }, flexInput: { flex: 1 },
  close: { color: '#f1cf71', fontWeight: '900', marginBottom: 16 }, detailImage: { width: '100%', height: 300, resizeMode: 'contain', borderRadius: 20, backgroundColor: '#111722', marginBottom: 20 }, detailPrice: { color: '#f7f2e8', fontSize: 48, fontWeight: '900', letterSpacing: -2, marginTop: 16 },
});
