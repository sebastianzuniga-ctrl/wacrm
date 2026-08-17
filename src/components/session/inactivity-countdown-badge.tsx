"use client";

import { useEffect, useState } from "react";

// Badge discreto (solo visible cuando quedan <5 min) que muestra la
// cuenta regresiva hasta el auto-logout por inactividad. Lee la
// cookie pública `wacrm_session_meta` (sin datos sensibles, solo
// timestamp + límite) que el middleware refresca en cada request.
// Es solo informativo: el corte real lo hace el middleware
// server-side con la cookie httpOnly `wacrm_last_seen`.
function readSessionMeta(): { lastSeen: number; limitMs: number } | null {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("wacrm_session_meta="));
  if (!match) return null;
  try {
    const raw = decodeURIComponent(match.split("=").slice(1).join("="));
    const parsed = JSON.parse(raw);
    if (typeof parsed.lastSeen === "number" && typeof parsed.limitMs === "number") {
      return parsed;
    }
  } catch {
    // cookie mal formada o ausente — se ignora, el badge no se muestra
  }
  return null;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Umbral bajo el cual el badge se hace visible. El resto del tiempo
// no se muestra nada para no distraer.
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;

export function InactivityCountdownBadge() {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const meta = readSessionMeta();
      if (!meta) {
        setRemainingMs(null);
        return;
      }
      const elapsed = Date.now() - meta.lastSeen;
      setRemainingMs(meta.limitMs - elapsed);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  if (remainingMs === null || remainingMs > WARNING_THRESHOLD_MS || remainingMs <= 0) {
    return null;
  }

  return (
    <div className="fixed bottom-3 right-3 z-50 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-500 shadow-sm">
      Sesión inactiva — cierre en {formatRemaining(remainingMs)}
    </div>
  );
}
