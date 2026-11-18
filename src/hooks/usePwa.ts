import { useCallback, useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

const DISMISS_KEY = "smartcbt:pwa-dismissed";

export function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)");
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean })?.standalone === true;
  return !!mql?.matches || iosStandalone;
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isTouchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return (/iphone|ipad|ipod/i.test(ua) || isTouchMac) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

// ── Shared module-level store ─────────────────────────────────────────────────
// `beforeinstallprompt` fires once per page load (often before a user navigates
// past /login). Storing the deferred event globally guarantees every mounted
// Install App button or banner receives it regardless of navigation timing.
interface PwaStoreState {
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
  installing: boolean;
  dismissed: boolean;
}

function readDismissed(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

const store: PwaStoreState = {
  deferred: null,
  installed: isStandaloneMode(),
  installing: false,
  dismissed: readDismissed(),
};

const listeners = new Set<() => void>();
let captureInitialized = false;

function notify() {
  for (const listener of listeners) listener();
}

export function initPwaInstallCapture(): void {
  if (captureInitialized || typeof window === "undefined") return;
  captureInitialized = true;

  const onPrompt = (e: Event) => {
    e.preventDefault();
    store.deferred = e as BeforeInstallPromptEvent;
    notify();
  };

  const onInstalled = () => {
    store.installed = true;
    store.deferred = null;
    store.installing = false;
    notify();
  };

  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);

  const mql = window.matchMedia?.("(display-mode: standalone)");
  const onDisplayChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      store.installed = true;
      store.deferred = null;
      notify();
    }
  };
  mql?.addEventListener?.("change", onDisplayChange);
}

// Initialize immediately on module import so early `beforeinstallprompt` events
// are never missed.
initPwaInstallCapture();

/**
 * Captures the PWA `beforeinstallprompt` event globally so any UI component
 * can trigger the native browser installation dialog on demand.
 */
export function usePwaInstall() {
  const [, setTick] = useState(0);

  useEffect(() => {
    initPwaInstallCapture();
    const onChange = () => setTick((n) => n + 1);
    listeners.add(onChange);
    // Sync standalone flag on mount in case environment changed before subscription.
    const currentStandalone = isStandaloneMode();
    if (currentStandalone && !store.installed) {
      store.installed = true;
      store.deferred = null;
      onChange();
    }
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const promptEvent = store.deferred;
    if (!promptEvent || store.installing) return false;
    store.installing = true;
    notify();
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice.catch(() => ({
        outcome: "dismissed" as const,
        platform: "",
      }));
      if (choice.outcome === "accepted") {
        store.installed = true;
        store.deferred = null;
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      store.installing = false;
      notify();
    }
  }, []);

  const dismiss = useCallback(() => {
    store.dismissed = true;
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    notify();
  }, []);

  const ios = isIosDevice();
  const canInstall = !!store.deferred && !store.installed;

  return {
    canInstall,
    isInstallable: canInstall,
    installed: store.installed,
    isInstalled: store.installed,
    isInstalling: store.installing,
    isIosDevice: ios,
    isIOS: ios,
    showIosHint: ios && !store.installed,
    dismissed: store.dismissed,
    dismiss,
    promptInstall,
    install: promptInstall,
  };
}

/** Tracks navigator.onLine so exam/dashboard UI can warn when offline. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine)
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
