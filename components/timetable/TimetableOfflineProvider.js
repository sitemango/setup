'use client';

/**
 * The offline/install state machine for one batch.
 *
 * One provider per timetable page, three consumers (the header pill, the
 * install card, the bottom sheet) plus the offline shell, all reading the same
 * answer to two independent questions: *is this batch on the device?* and
 * *can this browser install it?*
 *
 * The order of operations is the contract the feature needs:
 *
 *   1. a saved copy is read from IndexedDB and used immediately;
 *   2. the live snapshot is fetched from the real data source;
 *   3. the stored copy is replaced only after the response validates — and the
 *      store itself decides whether anything actually changed, by checksum;
 *   4. a failed refresh keeps the previous copy and says so;
 *   5. installation is offered only once the copy is on the device, and its
 *      outcome is tracked separately from the save's.
 *
 * Everything device-shaped — the clock, storage, `navigator.onLine`, the
 * service-worker registration — is read inside an effect, never during
 * render. That is both the React purity rule and the hydration rule the
 * timetable already follows: the server HTML and the first client render show
 * the same "checking this device" state, and the real one arrives after.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { describeBatch } from '@/lib/timetable/batch';
import { formatSavedAgo, snapshotFreshness, validateSnapshot } from '@/lib/timetable/offline';
import {
  clearSavedBatches,
  listSavedBatches,
  loadBatch,
  readSetting,
  removeBatch,
  requestPersistence,
  saveBatch,
  storageStatus,
  writeSetting,
} from '@/lib/timetable/offline-store';
import {
  cacheCurrentDocument,
  collectShellAssetUrls,
  detectPlatform,
  dropOfflineCaches,
  installOfferDecision,
  installPathFor,
  isMobileFormFactor,
  isStandalone,
  precacheOfflineShell,
  registerTimetableWorker,
  sendPrecacheMessage,
  unregisterOwnWorker,
  parkInstallPrompt,
  showInstallPrompt,
  skipWaiting,
  watchInstallPrompt,
  watchInstalled,
  workerAllowed,
} from '@/lib/timetable/offline-install';

const TimetableOfflineContext = createContext(null);

/**
 * `process.env.NODE_ENV` is inlined by the build, so this is a constant to the
 * bundle — read at module scope rather than per render so nothing downstream
 * has to carry it as a dependency. It decides whether a service worker is
 * registered at all: in `next dev` a worker would pin a stale bundle between
 * reloads and make the page look broken while the code is being edited.
 */
const PRODUCTION = process.env.NODE_ENV === 'production';

/** Shown as a checklist while preparing, so a several-second save is not a spinner. */
export const PREPARE_STEPS = [
  { key: 'read', label: 'Reading the printed week' },
  { key: 'store', label: 'Saving it on this device' },
  { key: 'shell', label: 'Caching the offline timetable view' },
  { key: 'assets', label: 'Caching the styles and scripts it needs' },
];

const UNKNOWN_FRESHNESS = { state: 'unknown', label: 'Saved copy', ageMs: null };

/**
 * The first listener, attached when this module is evaluated rather than when React
 * renders: the install event has no queue, so one that fires while the page is still
 * reading IndexedDB is simply gone. The event is parked on `window` (where the browser
 * gate can see it too) and adopted by the provider's first effect, so the offer is as
 * early as the browser allows without ever calling `prompt()` before a click. Never
 * disposed on purpose — there is one document per page view here, and the listener
 * holds nothing but a reference the provider takes over.
 */
if (typeof window !== 'undefined') parkInstallPrompt(window);

export function useTimetableOffline() {
  const context = useContext(TimetableOfflineContext);
  if (!context) throw new Error('useTimetableOffline must be used inside <TimetableOfflineProvider>');
  return context;
}

export function TimetableOfflineProvider({ division, children }) {
  const batch = useMemo(() => describeBatch(division), [division]);
  const platform = useMemo(() => detectPlatform(navigator.userAgent, navigator), []);
  const standalone = useMemo(() => isStandalone((query) => window.matchMedia?.(query), navigator), []);

  // A provider without a batch has nothing to read, so it starts "done" — the
  // pill would otherwise sit on "checking this device" forever.
  const [hydrated, setHydrated] = useState(() => !batch);
  const [saved, setSaved] = useState(null);
  const [savedList, setSavedList] = useState([]);
  const [phase, setPhase] = useState('idle');
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [offlineView, setOfflineView] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [promptEvent, setPromptEvent] = useState(null);
  const [install, setInstall] = useState({ outcome: 'unknown', installed: false });
  const [worker, setWorker] = useState({ state: 'unsupported', scope: null, wide: false, updateAvailable: false });
  const [storage, setStorage] = useState({ backend: 'unknown', persisted: false });
  const [dismissed, setDismissed] = useState(false);
  /** The newest of the two dismissal stamps, as ISO text; drives the cool-off. */
  const [dismissedAt, setDismissedAt] = useState(null);
  /** The last native prompt this device accepted — a longer silence than a dismissal. */
  const [acceptedAt, setAcceptedAt] = useState(null);
  const [mobile, setMobile] = useState(false);
  const [offer, setOffer] = useState({ show: false, reason: 'checking-device' });
  const [sheet, setSheet] = useState(null);
  const [device, setDevice] = useState({ savedAgo: null, freshness: UNKNOWN_FRESHNESS });

  // Two pieces of mutable machinery, both written and read only inside
  // effects/callbacks: an in-flight guard so a double click cannot start two
  // saves, and the registration the card talks to.
  const busy = useRef(false);
  /** Whether *this device* has an offline copy, kept in step from effects only. */
  const savedRef = useRef(false);
  /**
   * At most one proactive offer per page view — including after it is dismissed,
   * closed, or answered. Without this the offer effect would re-open the sheet the
   * instant the user closes it, which is nagging with extra steps.
   */
  const offerAsked = useRef(false);
  const registration = useRef(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  /* -----------------------------------------------------------------------
     Reconcile with the server: fetch, validate, let the store decide
     ----------------------------------------------------------------------- */

  const refresh = useCallback(
    async ({ silent = true } = {}) => {
      if (!batch) return { ok: false, error: 'no-batch' };
      if (!navigator.onLine) {
        if (mounted.current) {
          setOfflineView(true);
          if (!silent) setNeedsRefresh(true);
        }
        return { ok: false, offline: true };
      }

      // Only a batch the student has already saved is auto-refreshed. Check
      // that before touching the network: with no stored copy there is nothing
      // to reconcile, and a public page must not download a snapshot it cannot
      // persist. The explicit Save action still uses fetchSnapshot below.
      if (!savedRef.current) {
        if (mounted.current) setRefreshFailed(false);
        return { ok: true, changed: false, skipped: 'not-saved' };
      }

      if (!silent && mounted.current) {
        setPhase('refreshing');
        setError(null);
      }

      try {
        const response = await fetch(batch.apiUrl, { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error(`service-${response.status}`);
        const body = await response.json();
        const validated = validateSnapshot(body?.snapshot, { expectDivision: batch.division });
        if (!validated.ok) throw new Error(`invalid-${validated.error}`);

        // The store compares checksums, so an unchanged week is a no-op write
        // and "last saved" does not creep forward on every reload.
        const written = await saveBatch({ ...validated.snapshot, savedAt: new Date().toISOString() });
        if (!written.ok) throw new Error(`store-${written.error}`);
        if (!mounted.current) return { ok: true, changed: !written.unchanged };

        if (written.record) setSaved(written.record);
        savedRef.current = true;
        setSavedList((await listSavedBatches())?.batches ?? []);
        setPhase('ready');
        setRefreshFailed(false);
        setNeedsRefresh(false);
        setError(null);
        return { ok: true, changed: !written.unchanged };
      } catch {
        // A failed refresh must never empty the page: whatever is stored stays
        // stored, and the copy is labelled by its own age instead.
        if (!mounted.current) return { ok: false };
        setPhase('idle');
        setRefreshFailed(true);
        if (!silent) setError('The latest timetable could not be read. Your saved copy is still here.');
        return { ok: false };
      }
    },
    [batch],
  );

  /**
   * Capture the install event before anything else runs.
   *
   * This effect is deliberately the first one, and it is synchronous: Chrome
   * fires the install event when it decides the app is installable, not when
   * this page is ready to hear about it, so a listener attached after an `await`
   * can miss it outright. `watchInstallPrompt` also adopts the event the module-scope
   * capture parked in `window.__cpInstallPrompt`, which covers the case where it
   * fired before this effect ran at all.
   */
  useEffect(() => {
    const stopWatchingPrompt = watchInstallPrompt(window, (event) => setPromptEvent(event));
    // Chrome only offers an install for an app it can see a worker for, so the
    // registration is the first thing this page does — not something that happens
    // after the offline store has been opened and the snapshot revalidated.
    if (workerAllowed(PRODUCTION)) {
      void (async () => {
        const result = await registerTimetableWorker(navigator);
        if (!mounted.current) return;
        setWorker((state) => ({ ...state, ...result, updateAvailable: Boolean(result.registration?.waiting) }));
        registration.current = result.registration ?? null;
        // A worker left `waiting` by a deploy is an offer, never a surprise
        // reload: the card gets a button and the page reloads when it is used.
        registration.current?.addEventListener?.('updatefound', () => {
          const next = registration.current?.waiting;
          if (!next) return;
          next.addEventListener?.('statechange', () => {
            if (next.state === 'installed' && mounted.current) setWorker((state) => ({ ...state, updateAvailable: true }));
          });
        });
      })();
    }
    const stopWatchingInstalled = watchInstalled(window, () => {
      if (!mounted.current) return;
      setInstall((state) => ({ ...state, installed: true, outcome: 'accepted' }));
      setSheet(null);
    });
    return () => {
      stopWatchingPrompt();
      stopWatchingInstalled();
    };
  }, []);

  /* -----------------------------------------------------------------------
     Mount: read the device, then refresh
     ----------------------------------------------------------------------- */

  useEffect(() => {
    if (!batch) return undefined;

    (async () => {
      const [stored, all, promptDismissedAt, offerDismissedAt, acceptedAt, storageState] = await Promise.all([
        loadBatch(batch.division),
        listSavedBatches(),
        readSetting('installDismissedAt'),
        readSetting('installOfferDismissedAt'),
        readSetting('installAcceptedAt'),
        storageStatus(),
      ]);
      if (!mounted.current) return;

      setSaved(stored?.snapshot ? stored.record : null);
      savedRef.current = Boolean(stored?.snapshot);
      setSavedList(all?.batches ?? []);
      setDismissed(Boolean(promptDismissedAt || offerDismissedAt));
      setDismissedAt(newestIso(promptDismissedAt, offerDismissedAt));
      setAcceptedAt(acceptedAt ?? null);
      setStorage(storageState ?? { backend: 'unknown', persisted: false });
      // Read with the rest of the device state rather than in the effect body: the
      // offer must not be decided from a value that changes between the first paint
      // and hydration, and React's rule against synchronous setState in an effect
      // is the same instinct as this file's "nothing device-shaped in render".
      setMobile(
        isMobileFormFactor({
          matchMedia: (query) => window.matchMedia?.(query),
          navigatorLike: navigator,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }),
      );
      setOfflineView(!navigator.onLine);
      setPhase(stored?.snapshot ? 'ready' : 'idle');
      setHydrated(true);

      await refresh({ silent: true });
    })();

    // The provider is mounted per division page — a batch change is a
    // navigation to a different page, not a prop update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.division, refresh]);

  const installPath = installPathFor(platform, { hasBeforeInstallPrompt: Boolean(promptEvent) });
  const savedReady = Boolean(saved?.checksum);

  /* -----------------------------------------------------------------------
     The proactive offer: one sheet, on phones, when it can actually help
     ----------------------------------------------------------------------- */

  useEffect(() => {
    const decision = installOfferDecision({
      hasBatch: Boolean(batch),
      hydrated,
      mobile,
      standalone,
      installed: install.installed,
      savedReady,
      preparing: phase === 'preparing' || phase === 'refreshing',
      offline: offlineView,
      sheet,
      alreadyShown: offerAsked.current,
      dismissedAt,
      acceptedAt,
    });
    setOffer((state) => (state.reason === decision.reason && state.show === decision.show ? state : decision));
    if (!decision.show) return;
    offerAsked.current = true;
    setSheet('offer');
  }, [
    batch,
    hydrated,
    mobile,
    standalone,
    install.installed,
    savedReady,
    phase,
    offlineView,
    sheet,
    dismissedAt,
    acceptedAt,
  ]);

  /* -----------------------------------------------------------------------
     Connectivity, and the age of the copy we are showing
     ----------------------------------------------------------------------- */

  useEffect(() => {
    const goOffline = () => setOfflineView(true);
    const goOnline = () => {
      setOfflineView(false);
      setNeedsRefresh(true);
      refresh({ silent: true });
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [refresh]);

  /**
   * Time-dependent labels — "saved 4 minutes ago", fresh vs stale.
   *
   * The clock cannot be read during render (the server HTML has no idea when
   * this component hydrates, and a re-render must not move the label
   * backwards), and it is deferred one tick rather than set synchronously so
   * the first paint and the first client render are the same. Same reason the
   * mount path above does all of its state updates after an await.
   */
  useEffect(() => {
    if (!hydrated) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      setDevice({
        savedAgo: saved ? formatSavedAgo(saved.savedAt, new Date()) : null,
        freshness: snapshotFreshness(
          saved ? { savedAt: saved.savedAt, generatedAt: saved.generatedAt } : null,
          Date.now(),
        ),
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [hydrated, saved, offlineView]);

  /* -----------------------------------------------------------------------
     Prepare: data first, then the shell that renders it
     ----------------------------------------------------------------------- */

  const prepare = useCallback(async () => {
    if (!batch || busy.current) return { ok: false, skipped: true };
    busy.current = true;
    setPhase('preparing');
    setError(null);

    try {
      await requestPersistence();

      setStep(PREPARE_STEPS[0].key);
      const fetched = await fetchSnapshot(batch);
      if (!fetched.ok) throw new Error(fetched.error);
      const validated = validateSnapshot(fetched.snapshot, { expectDivision: batch.division });
      if (!validated.ok) throw new Error(`The response did not contain a complete week (${validated.error}).`);

      setStep(PREPARE_STEPS[1].key);
      const written = await saveBatch({ ...validated.snapshot, savedAt: new Date().toISOString() });
      if (!written.ok) throw new Error(storeErrorMessage(written.error));
      if (!mounted.current) return { ok: true };
      if (written.record) setSaved(written.record);
      savedRef.current = true;
      setSavedList((await listSavedBatches())?.batches ?? []);

      // The worker is a bonus, not a precondition: a page that cannot cache its
      // own chunks still has the data, so a failure here is reported and the
      // flow continues instead of being called a failed save.
      if (workerAllowed(PRODUCTION)) {
        setStep(PREPARE_STEPS[2].key);
        await precacheOfflineShell(registration.current);

        setStep(PREPARE_STEPS[3].key);
        const target = registration.current ?? (await navigator.serviceWorker?.getRegistration?.()) ?? null;
        const [pageCache, assetCache] = await Promise.all([
          cacheCurrentDocument(target),
          sendPrecacheMessage(target, collectShellAssetUrls(performance.getEntriesByType('resource'), location.origin)),
        ]);
        // The data is saved either way — that part is honest and permanent. What
        // failed is the *page*, so the message says exactly that instead of
        // claiming the offline copy is incomplete when it is not.
        if (mounted.current && (!pageCache.cached || assetCache.state === 'error')) {
          setError(
            pageCache.cached
              ? 'The timetable is saved; the browser would not cache every style and script, so an offline open may need a reload.'
              : 'The timetable is saved; the browser would not keep this page, so an offline open relies on the browser’s own cache.',
          );
        }
      }

      if (!mounted.current) return { ok: true };
      await writeSetting('lastPrepareAt', new Date().toISOString());
      setPhase('ready');
      setStep(null);
      setError(null);
      return { ok: true };
    } catch (caught) {
      if (mounted.current) {
        setPhase('error');
        setStep(null);
        setError(prepareErrorMessage(caught));
      }
      return { ok: false, error: prepareErrorMessage(caught) };
    } finally {
      busy.current = false;
    }
  }, [batch]);

  /**
   * The button. Preparation runs first and gates the prompt: an install offer
   * that cannot open offline would be a worse promise than no offer at all.
   */
  const installNow = useCallback(async () => {
    if (!saved) {
      const prepared = await prepare();
      if (prepared.skipped) return { outcome: 'busy' };
      if (!prepared.ok) return { outcome: 'prepare-failed', error: prepared.error };
    }

    if (promptEvent?.prompt) {
      setInstall((state) => ({ ...state, outcome: 'waiting', path: 'native' }));
      const result = await showInstallPrompt(promptEvent);
      if (!mounted.current) return result;
      // A used prompt event is spent — Chrome will not hand this navigation
      // another one — so it is dropped rather than kept behind a button that has
      // quietly stopped doing anything. `installPath` follows, and the offer
      // becomes instructions, which is still a way to install.
      setPromptEvent(null);
      setInstall((state) => ({
        ...state,
        outcome: result.outcome,
        installed: result.outcome === 'accepted' ? true : state.installed,
      }));
      const stamp = new Date().toISOString();
      if (result.outcome === 'accepted') {
        setSheet(null);
        setAcceptedAt(stamp);
        await writeSetting('installAcceptedAt', stamp);
      }
      if (result.outcome === 'dismissed') {
        setDismissed(true);
        setDismissedAt(stamp);
        await writeSetting('installDismissedAt', stamp);
      }
      // The browser refused to show a prompt (criteria unmet, or already
      // handled): fall back to instructions instead of a dead end.
      if (result.outcome === 'unsupported') setSheet(platform.kind === 'ios' ? 'ios' : 'manual');
      return result;
    }

    // iOS has no install API at all, and no other browser has one either when the
    // event was never offered: instructions.
    setSheet(platform.kind === 'ios' ? 'ios' : 'manual');
    return { outcome: 'manual' };
  }, [platform.kind, prepare, promptEvent, saved]);

  /* ----------------------------------------------------------------------- */

  const removeSaved = useCallback(async () => {
    if (!batch) return;
    await removeBatch(batch.division);
    // Only this batch's record goes. Its cached *page* stays: it is a public
    // document, it is revalidated from the network whenever there is one, and
    // with the data gone the offline view reads "Nothing saved for this
    // timetable yet". Clearing every cache to remove one batch would punish the
    // other batches saved on this device.
    savedRef.current = false;
    if (!mounted.current) return;
    setSaved(null);
    setSavedList((await listSavedBatches())?.batches ?? []);
    setPhase('idle');
  }, [batch]);

  const removeAllSaved = useCallback(async () => {
    await clearSavedBatches();
    // The stored data is only half of what "remove" promises. The pages this
    // feature cached have to go with it, or an offline open still shows a
    // timetable the student deleted. Both calls are name-scoped: this feature's
    // caches, this feature's worker script, nothing else on the origin.
    const target = registration.current ?? (await navigator.serviceWorker?.getRegistration?.()) ?? null;
    await dropOfflineCaches(target);
    await unregisterOwnWorker(typeof navigator === 'undefined' ? null : navigator);
    registration.current = null;
    savedRef.current = false;
    if (!mounted.current) return;
    setSaved(null);
    setSavedList([]);
    setPhase('idle');
  }, []);

  /**
   * Closing the offer is an answer, not a pause: the stamp is written before the
   * sheet goes away, so a reload of the same page does not ask again. Only the
   * proactive offer records it — closing a status or instructions sheet changes
   * nothing, because reading the status is not a refusal.
   */
  const dismissSheet = useCallback(async () => {
    if (sheet === 'offer') {
      const stamp = new Date().toISOString();
      offerAsked.current = true;
      setDismissedAt(stamp);
      await writeSetting('installOfferDismissedAt', stamp);
    }
    if (mounted.current) setSheet(null);
  }, [sheet]);

  /** Deliberately manual: the student chooses when the page swaps under them. */
  const applyUpdate = useCallback(async () => {
    const target = registration.current ?? (await navigator.serviceWorker?.getRegistration?.()) ?? null;
    if (!target) return false;
    const applied = skipWaiting(target);
    if (applied) window.setTimeout(() => window.location.reload(), 50);
    return applied;
  }, []);

  const value = useMemo(
    () => ({
      batch,
      hydrated,
      saved,
      savedList,
      savedReady,
      freshness: device.freshness,
      savedAgo: device.savedAgo,
      phase,
      step,
      steps: PREPARE_STEPS,
      error,
      refreshFailed,
      offlineView,
      online: !offlineView,
      needsRefresh,
      storage,
      worker,
      install: { ...install, path: installPath },
      installPath,
      hasPrompt: Boolean(promptEvent),
      mobile,
      offer,
      standalone,
      platform,
      dismissed,
      sheet,
      openSheet: setSheet,
      dismissSheet,
      prepare,
      installNow,
      refresh,
      removeSaved,
      removeAllSaved,
      applyUpdate,
    }),
    [
      batch,
      hydrated,
      saved,
      savedList,
      savedReady,
      device,
      phase,
      step,
      error,
      refreshFailed,
      offlineView,
      needsRefresh,
      storage,
      worker,
      install,
      installPath,
      promptEvent,
      mobile,
      offer,
      standalone,
      platform,
      dismissed,
      sheet,
      prepare,
      installNow,
      dismissSheet,
      refresh,
      removeSaved,
      removeAllSaved,
      applyUpdate,
    ],
  );

  return <TimetableOfflineContext.Provider value={value}>{children}</TimetableOfflineContext.Provider>;
}

/* --------------------------------------------------------------------------
   Failure copy
   -------------------------------------------------------------------------- */

/** The later of two ISO stamps, or null when neither exists. */
function newestIso(first, second) {
  const a = Date.parse(first ?? '');
  const b = Date.parse(second ?? '');
  if (Number.isNaN(a)) return Number.isNaN(b) ? null : second;
  if (Number.isNaN(b)) return first;
  return a >= b ? first : second;
}

/**
 * The three storage failures a student can actually hit, in their words. A
 * quota message that says "clear some offline timetables" is actionable;
 * "IndexedDB threw QuotaExceededError" is not.
 */
function storeErrorMessage(code) {
  if (code === 'quota') return 'This device has no room left for offline timetables. Remove a saved batch and try again.';
  if (code === 'storage-unavailable') return 'This browser will not let the page store anything — private windows usually block it.';
  if (String(code ?? '').startsWith('invalid-snapshot')) return 'Campus+ returned a timetable this version cannot save.';
  return 'The offline copy could not be written to this device.';
}

function prepareErrorMessage(caught) {
  const message = String(caught?.message || caught || '');
  if (message.includes('offline')) return 'You are offline. Open this timetable once with a connection and it will be saved.';
  if (/service-\d+/.test(message)) return 'The timetable service did not answer, so nothing was overwritten.';
  return message.slice(0, 180);
}

async function fetchSnapshot(batch) {
  if (!navigator.onLine) return { ok: false, error: 'offline' };
  try {
    const response = await fetch(batch.apiUrl, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return { ok: false, error: `service-${response.status}` };
    const body = await response.json();
    if (!body?.snapshot) return { ok: false, error: 'no-snapshot' };
    return { ok: true, snapshot: body.snapshot };
  } catch {
    return { ok: false, error: 'offline' };
  }
}
