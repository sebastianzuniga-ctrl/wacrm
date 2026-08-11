"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, Hand, Undo2, Loader2, UserCheck, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";

// ------------------------------------------------------------
// Account AI status is the same for every conversation, so cache it per
// account and reuse it across thread switches instead of hitting
// /api/ai/config every time the agent opens a chat.
//
// Keyed by accountId (a multi-account user switching workspaces must not
// see the previous account's status), and only *successful* fetches are
// cached — a transient failure returns a default without poisoning the
// cache, so it retries on the next thread open rather than hiding the
// banner for the whole session.
// ------------------------------------------------------------
interface AiAccountStatus {
  autoReplyOn: boolean;
}
const statusCache = new Map<string, AiAccountStatus>();

async function fetchAiAccountStatus(accountId: string): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;
  try {
    const res = await fetch("/api/ai/config", { cache: "no-store" });
    if (!res.ok) return { autoReplyOn: false }; // don't cache a transient failure
    const j = await res.json();
    const status = {
      // AI auto-reply is "live" only when configured, the master switch
      // is on, and the inbound bot is enabled.
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false }; // don't cache
  }
}

interface AiThreadBannerProps {
  conversationId: string;
  /** `conversations.ai_autoreply_disabled` — bot paused on this thread. */
  disabled: boolean;
  /** `conversations.ai_handoff_summary` — note the bot left on handoff. */
  handoffSummary?: string | null;
  /** Current assignee; when a human owns the thread the bot won't run,
   *  so the "AI active" banner is suppressed. */
  assignedAgentId?: string | null;
  /** The acting agent — "Take over" / "Claim" assigns the thread to them. */
  currentUserId?: string | null;
  /** Called after a successful toggle so the parent can patch its local
   *  conversation state (the realtime UPDATE also arrives, but this keeps
   *  the banner instant). */
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

/**
 * Inbox banner that surfaces + controls conversation ownership:
 *   - nobody has claimed the thread yet → [Claim conversation], regardless
 *     of whether AI is even configured (an 'agent' can't write until
 *     someone owns the thread — see /api/whatsapp/send's server-side gate)
 *   - claimed + bot active here → "AI is replying automatically" + [Take over]
 *   - claimed + bot paused here → the handoff note (if any) + [Resume AI]
 *   - claimed + bot active + no auto-reply configured → nothing to show
 */
export function AiThreadBanner({
  conversationId,
  disabled,
  handoffSummary,
  assignedAgentId,
  currentUserId,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations("Inbox.aiBanner");
  const { accountId } = useAuth();
  const canAct = useCan("send-messages"); // viewers can't claim/take over either
  const [autoReplyOn, setAutoReplyOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  // Optimistic local mirror of the pause flag so the banner flips
  // instantly on click; re-seeds whenever the thread (or its server
  // state via realtime) changes.
  const [paused, setPaused] = useState(disabled);
  useEffect(() => setPaused(disabled), [conversationId, disabled]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    fetchAiAccountStatus(accountId).then((s) => alive && setAutoReplyOn(s.autoReplyOn));
    return () => {
      alive = false;
    };
  }, [accountId]);

  const toggle = useCallback(
    async (paused: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // "Take over" also assigns the thread to the acting agent.
          body: JSON.stringify({ paused, assign_to_me: paused }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error ?? t("updateError"));
          return;
        }
        setPaused(paused);
        onChange?.({
          ai_autoreply_disabled: paused,
          // Take over assigns to the acting agent; resume releases only
          // the caller's own assignment. The realtime UPDATE reconciles
          // the exact value either way.
          ...(paused
            ? currentUserId
              ? { assigned_agent_id: currentUserId }
              : {}
            : { assigned_agent_id: null }),
        });
        toast.success(paused ? t("tookOver") : t("resumed"));
      } catch {
        toast.error(t("networkError"));
      } finally {
        setBusy(false);
      }
    },
    [conversationId, currentUserId, onChange, t],
  );

  // "Tomar contacto" — claims an unassigned thread (atomic on the
  // server: fails with 409 if another agent claimed it first) and
  // greets the customer. Works regardless of AI/paused state — this is
  // the general "someone must own this thread before writing" claim,
  // distinct from `toggle(true)` ("Take over"), which specifically
  // pauses an *active* bot without sending anything.
  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/claim`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ?? t("claimError"));
        return;
      }
      onChange?.({
        ai_autoreply_disabled: true,
        assigned_agent_id: currentUserId ?? null,
      });
      toast.success(t("claimed"));
    } catch {
      toast.error(t("networkError"));
    } finally {
      setClaiming(false);
    }
  }, [conversationId, currentUserId, onChange, t]);

  // "Liberar conversación" -- devuelve un ticket que ya es mio a la
  // cola sin asignar, para que otro ejecutivo lo tome. Distinto de
  // "Reanudar IA": el bot sigue pausado, solo cambia el dueño.
  const release = useCallback(async () => {
    setReleasing(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/release`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ?? t("releaseError"));
        return;
      }
      onChange?.({
        ai_autoreply_disabled: true,
        assigned_agent_id: null,
      });
      toast.success(t("released"));
    } catch {
      toast.error(t("networkError"));
    } finally {
      setReleasing(false);
    }
  }, [conversationId, onChange, t]);

  // Nobody owns this thread yet — always offer a way to grab it, whether
  // the bot is actively replying, paused after a handoff, or there's no
  // AI configured for the account at all. This is the one case that must
  // render unconditionally: it's the only way an 'agent' caller can
  // unblock their own composer (see the `claimRequired` gate in
  // message-thread.tsx / the server-side check in /api/whatsapp/send).
  if (!assignedAgentId) {
    // Bot is actively mid-conversation — "Take over" (pause + assign,
    // no unsolicited greeting; the bot already has context with the
    // customer, so injecting "Hi, I'm X" here would read as redundant).
    if (autoReplyOn && !paused) {
      return (
        <Banner tone="primary">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
            <span className="truncate font-medium text-foreground">
              {t("activeText")}
            </span>
          </div>
          {canAct && (
            <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
              {t("takeOver")}
            </BannerButton>
          )}
        </Banner>
      );
    }
    // Paused after a handoff, or no AI configured at all — "Claim"
    // (assign + greet, since the customer isn't already mid-conversation
    // with an active bot).
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {paused && handoffSummary ? t("pausedTitle") : t("unclaimedTitle")}
          </p>
          {paused && handoffSummary && (
            <p className="truncate text-muted-foreground" title={handoffSummary}>
              {handoffSummary}
            </p>
          )}
        </div>
        {canAct && (
          <BannerButton onClick={claim} busy={claiming} icon={UserCheck}>
            {t("claim")}
          </BannerButton>
        )}
      </Banner>
    );
  }

  // From here on the thread has an owner. If it's the acting agent's
  // own ticket, always offer a way to release it back to the queue --
  // independent of AI status, since an agent might want to hand off a
  // ticket they're already chatting in normally (no bot involved at
  // all), not just a paused-bot handoff.
  const isMine = !!currentUserId && assignedAgentId === currentUserId;

  if (paused && isMine) {
    // Paused here (the model handed off, and this agent claimed it) --
    // offer both "Reanudar IA" and "Liberar conversación".
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{t("pausedTitle")}</p>
          {handoffSummary && (
            <p className="truncate text-muted-foreground" title={handoffSummary}>
              {handoffSummary}
            </p>
          )}
        </div>
        {canAct && (
          <div className="flex flex-shrink-0 items-center gap-2">
            <BannerButton onClick={release} busy={releasing} icon={LogOut}>
              {t("release")}
            </BannerButton>
            {autoReplyOn && (
              <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
                {t("resume")}
              </BannerButton>
            )}
          </div>
        )}
      </Banner>
    );
  }

  if (paused) {
    // Paused, but owned by someone else -- nothing for this agent to do.
    if (!autoReplyOn) return null;
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{t("pausedTitle")}</p>
          {handoffSummary && (
            <p className="truncate text-muted-foreground" title={handoffSummary}>
              {handoffSummary}
            </p>
          )}
        </div>
      </Banner>
    );
  }

  // Not paused. If it's mine (chatting normally, bot inactive on this
  // thread either way), still offer "Liberar conversación" so an agent
  // can hand off a ticket they no longer want, even without any AI
  // pause involved.
  if (isMine && canAct) {
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{t("assignedToYouTitle")}</p>
        </div>
        <BannerButton onClick={release} busy={releasing} icon={LogOut}>
          {t("release")}
        </BannerButton>
      </Banner>
    );
  }

  // Active, owned by someone else → the bot won't fire; no banner.
  return null;
}

function Banner({
  tone,
  children,
}: {
  tone: "primary" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4",
        tone === "primary"
          ? "border-primary/20 bg-primary/5"
          : "border-border bg-muted/40",
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {children}
    </button>
  );
}
