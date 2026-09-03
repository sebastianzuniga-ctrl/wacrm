"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, X, EyeOff, MoreVertical } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};



type InboxFilter = "all" | "unread" | "assigned" | "openMine" | "pendingMine" | "closedMine";

type DateFilter = "today" | "3d" | "7d" | "all";

// Recuerda la ultima seleccion del agente para estos dos filtros entre
// sesiones (device-scoped), mismo patron que el toggle del panel de
// contacto en inbox/page.tsx -- sin esto, cada vez que el agente sale
// y vuelve a entrar el inbox vuelve a "Asignados a mi" + "Hoy" aunque
// haya estado trabajando con otro filtro.
const FILTER_STORAGE_KEY = "wacrm:inbox:filter";
const DATE_FILTER_STORAGE_KEY = "wacrm:inbox:date-filter";
// Pedido 2026-09-03: conversaciones creadas por campana sin que el
// paciente haya respondido todavia (has_customer_message=false)
// saturaban la lista. Oculto por defecto, con opcion de incluirlas
// que se recuerda igual que los otros filtros.
const INCLUDE_NO_REPLY_STORAGE_KEY = "wacrm:inbox:include-no-reply";
const FILTER_VALUES: InboxFilter[] = ["all", "unread", "assigned", "openMine", "pendingMine", "closedMine"];
const DATE_FILTER_VALUES: DateFilter[] = ["today", "3d", "7d", "all"];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  
  const { user } = useAuth();
  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterAssignedToMe"), value: "assigned" },
    { label: t("filterOpenMine"), value: "openMine" },
    { label: t("filterPendingMine"), value: "pendingMine" },
    { label: t("filterClosedMine"), value: "closedMine" },
  ], [t]);

  const DATE_FILTER_OPTIONS: { label: string; value: DateFilter }[] = useMemo(() => [
    { label: t("dateFilterToday"), value: "today" },
    { label: t("dateFilter3d"), value: "3d" },
    { label: t("dateFilter7d"), value: "7d" },
    { label: t("dateFilterAll"), value: "all" },
  ], [t]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("assigned");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [includeNoReply, setIncludeNoReply] = useState(false);
  const [loading, setLoading] = useState(true);

  // Restaura la ultima seleccion del agente. Se hace en un efecto (no
  // en el initializer de useState) para que el primer render coincida
  // con el default del server y no genere un mismatch de hidratacion.
  useEffect(() => {
    try {
      const storedFilter = localStorage.getItem(FILTER_STORAGE_KEY);
      if (storedFilter && (FILTER_VALUES as string[]).includes(storedFilter)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restaura un valor guardado tras el mount, no un ciclo de sincronizacion
        setFilter(storedFilter as InboxFilter);
      }
      const storedDateFilter = localStorage.getItem(DATE_FILTER_STORAGE_KEY);
      if (storedDateFilter && (DATE_FILTER_VALUES as string[]).includes(storedDateFilter)) {
        setDateFilter(storedDateFilter as DateFilter);
      }
      const storedIncludeNoReply = localStorage.getItem(INCLUDE_NO_REPLY_STORAGE_KEY);
      if (storedIncludeNoReply === "true") {
        setIncludeNoReply(true);
      }
    } catch {
      // localStorage puede tirar error en modo incognito / contextos
      // sandboxed -- si falla, simplemente se queda con los defaults.
    }
  }, []);

  const handleFilterChange = useCallback((value: InboxFilter) => {
    setFilter(value);
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, value);
    } catch {
      // Persistencia best-effort.
    }
  }, []);

  const handleDateFilterChange = useCallback((value: DateFilter) => {
    setDateFilter(value);
    try {
      localStorage.setItem(DATE_FILTER_STORAGE_KEY, value);
    } catch {
      // Persistencia best-effort.
    }
  }, []);
  const handleIncludeNoReplyChange = useCallback((value: boolean) => {
    setIncludeNoReply(value);
    try {
      localStorage.setItem(INCLUDE_NO_REPLY_STORAGE_KEY, value ? "true" : "false");
    } catch {
      // Persistencia best-effort.
    }
  }, []);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        // nullsFirst: false -- Postgres' default for DESC is NULLS
        // FIRST, so a conversation with no messages yet (last_message_at
        // IS NULL, e.g. right after a broadcast creates the contact)
        // would otherwise always float to the top, burying threads with
        // real, recent activity below every empty one.
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter === "assigned") {
      result = result.filter((c) => c.assigned_agent_id === user?.id);
    } else if (filter === "openMine") {
      result = result.filter((c) => c.status === "open" && c.assigned_agent_id === user?.id);
    } else if (filter === "pendingMine") {
      result = result.filter((c) => c.status === "pending" && c.assigned_agent_id === user?.id);
    } else if (filter === "closedMine") {
      result = result.filter((c) => c.status === "closed" && c.assigned_agent_id === user?.id);
    }

    // Filtro de fecha: por defecto "hoy" para no saturar la lista con
    // meses de historial (pedido explicito del usuario). Usa
    // last_message_at (actividad mas reciente), con fallback a
    // created_at para tickets sin mensajes todavia.
    if (dateFilter !== "all") {
      const now = new Date();
      let cutoff: number;
      if (dateFilter === "today") {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      } else if (dateFilter === "3d") {
        cutoff = now.getTime() - 3 * 24 * 60 * 60 * 1000;
      } else {
        cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      }
      result = result.filter((c) => {
        const ts = c.last_message_at ?? c.created_at;
        if (!ts) return false;
        return new Date(ts).getTime() >= cutoff;
      });
    }

    // Ocultar por defecto las conversaciones donde el paciente nunca
    // respondio (ej. campana recien enviada, sin interaccion) -- se
    // pueden incluir con el toggle, se recuerda la eleccion.
    if (!includeNoReply) {
      result = result.filter((c) => c.has_customer_message !== false);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, filter, dateFilter, includeNoReply, search, selectedTagIds, selectedCompany, user?.id]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);
  const activeDateFilter = DATE_FILTER_OPTIONS.find((o) => o.value === dateFilter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleFilterChange(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                dateFilter !== "all" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {activeDateFilter?.label ?? t("dateFilterToday")}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              {DATE_FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleDateFilterChange(opt.value)}
                  className={cn(
                    "text-sm",
                    dateFilter === opt.value ? "text-primary" : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Toggle simple (no dropdown, solo on/off) para incluir
              conversaciones sin respuesta del paciente -- ocultas por
              defecto, se recuerda la eleccion (pedido 2026-09-03). */}
          <button
            type="button"
            onClick={() => handleIncludeNoReplyChange(!includeNoReply)}
            className={cn(
              "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted whitespace-nowrap",
              includeNoReply ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {includeNoReply ? "✓ " : ""}Campañas
          </button>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
}: ConversationItemProps) {
  const { accountRole } = useAuth();
  const isAdmin = accountRole === "admin" || accountRole === "owner";
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);
  const handleMarkUnread = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const supabase = createClient();
      await supabase
        .from("conversations")
        .update({ unread_count: 1 })
        .eq("id", conversation.id);
    },
    [conversation.id],
  );

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  const isUnread = conversation.unread_count > 0;

  return (
    <div className="group relative">
      <button
        onClick={handleClick}
        className={cn(
          "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
          isUnread && "bg-rose-500/10 hover:bg-rose-500/15",
          isActive && "border-l-2 border-primary bg-muted/70"
        )}
      >
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
          {contact?.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">
              {conversation.last_message_text || t("noMessagesYet")}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {isUnread && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {conversation.unread_count}
                </span>
              )}
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  STATUS_COLORS[conversation.status]
                )}
                title={conversation.status}
              />
            </div>
          </div>
        </div>
      </button>
      {/* Menú de admin: marcar como no leído (reversible). No anidar
          dentro del <button> de arriba -- un botón dentro de otro
          botón es HTML inválido, por eso vive como hermano posicionado
          encima. Solo visible al hacer hover para no ensuciar la
          lista todo el tiempo. */}
      {isAdmin && !isUnread && (
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex"
            title={t("markUnread")}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={handleMarkUnread}>
              <EyeOff className="mr-2 h-3.5 w-3.5" />
              {t("markUnread")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
