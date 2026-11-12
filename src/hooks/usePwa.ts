import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)");
  const iosStandalone = (window.navigator as any)?.standalone === true;
  return !!mql?.matches || iosStandalone;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
}

/** Captures the `beforeinstallprompt` event so UI can trigger install on demand. */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("smartcbt:pwa-dismissed") === "1"
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    if (choice.outcome === "accepted") setDeferred(null);
    return choice.outcome === "accepted";
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem("smartcbt:pwa-dismissed", "1");
  }, []);

  return {
    canInstall: !!deferred && !installed,
    installed,
    isIosDevice: isIos(),
    showIosHint: isIos() && !isStandalone(),
    dismissed,
    dismiss,
    promptInstall,
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
