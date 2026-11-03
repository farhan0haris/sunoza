"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // 1. Register Service Worker if supported
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((registration) => {
            console.log("[PWA] Service Worker registered with scope:", registration.scope);
          })
          .catch((error) => {
            console.warn("[PWA] Service Worker registration failed:", error);
          });
      });
    }

    // 2. Check if already installed / standalone
    if (typeof window !== "undefined") {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;

      setIsStandalone(Boolean(isStandaloneMode));

      if (isStandaloneMode) {
        return; // Already installed, do not show prompt
      }

      // Check if dismissed within the last 7 days
      const lastDismissed = localStorage.getItem("sunoza_pwa_dismissed");
      if (lastDismissed) {
        const dismissedTime = parseInt(lastDismissed, 10);
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - dismissedTime < sevenDays) {
          return;
        }
      }

      // Detect iOS Safari
      const userAgent = window.navigator.userAgent.toLowerCase();
      const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
      const isSafari = /safari/.test(userAgent) && !/chrome|crios|fxios/.test(userAgent);
      if (isIosDevice && isSafari && !isStandaloneMode) {
        setIsIos(true);
        setShowPrompt(true);
      }

      // Listen for Android / Chromium beforeinstallprompt
      const handleBeforeInstall = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setShowPrompt(true);
      };

      const handleAppInstalled = () => {
        setShowPrompt(false);
        setDeferredPrompt(null);
        console.log("[PWA] Sunoza was installed successfully");
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstall);
      window.addEventListener("appinstalled", handleAppInstalled);

      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
        window.removeEventListener("appinstalled", handleAppInstalled);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (isIos) {
      setShowIosGuide(!showIosGuide);
      return;
    }

    if (!deferredPrompt) {
      return;
    }

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    } catch (err) {
      console.warn("[PWA] Prompt error:", err);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    if (typeof window !== "undefined") {
      localStorage.setItem("sunoza_pwa_dismissed", Date.now().toString());
    }
  };

  if (!showPrompt || isStandalone) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Install Sunoza application"
      className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 mx-auto max-w-lg rounded-2xl border border-[#DDD6C9] bg-[#FFFCF7] p-4 shadow-xl transition-all duration-300 sm:bottom-6 sm:left-auto sm:right-6 sm:w-96"
    >
      <div className="flex items-start gap-3.5">
        {/* Brand Badge */}
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#33446A] shadow-xs">
          <span className="font-bold text-base text-[#FFFCF7]">S</span>
          <span className="h-1.5 w-1.5 rounded-full bg-[#D99B37] -ml-0.5 mt-2"></span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-sm text-[#33446A] tracking-tight">
              Install Sunoza App
            </h3>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss install prompt"
              className="text-[#485E4B] hover:text-[#252A31] p-1 rounded-lg transition"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <p className="mt-1 text-xs text-[#485E4B] leading-relaxed">
            Install on your home screen for fast one-tap voice interaction and offline app shell access.
          </p>

          {/* iOS Safari Step-by-Step Guide */}
          {isIos && showIosGuide && (
            <div className="mt-3 rounded-xl border border-[#DDD6C9] bg-[#FAF7F0] p-3 text-xs text-[#33446A] space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <span>1. Tap the Share button</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                  <polyline points="16 6 12 2 8 6"></polyline>
                  <line x1="12" y1="2" x2="12" y2="15"></line>
                </svg>
                <span>in Safari</span>
              </div>
              <div className="font-semibold">
                2. Scroll down and tap <span className="underline">&ldquo;Add to Home Screen&rdquo;</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleInstallClick}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#33446A] px-3.5 py-2 text-xs font-semibold text-[#FFFCF7] shadow-xs hover:bg-[#263350] transition focus-visible:outline-2 focus-visible:outline-[#33446A]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>{isIos ? (showIosGuide ? "Hide instructions" : "How to install") : "Install"}</span>
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-[#485E4B] hover:text-[#252A31] transition"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

