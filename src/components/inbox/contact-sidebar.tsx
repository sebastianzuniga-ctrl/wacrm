"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  FileText,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Notifica al padre tras actualizar name/pac_codigo desde INO, para
   *  que refleje el cambio donde tenga su propia copia del contacto
   *  (activeContact, lista de conversaciones). */
  onContactUpdated?: (patch: Partial<Contact> & { id: string }) => void;
}

interface PacienteTelefonoCandidato {
  pac_codigo: string;
  pac_nombre: string;
  pac_apellido: string;
  pac_apellido_materno: string | null;
}

type FichaEstado = "activa" | "seleccionando" | "esperando_rut" | "sin_sesion";

interface FichaInfo {
  estado: FichaEstado;
  pac_codigo: string | null;
  pac_nombre: string | null;
  pac_apellido: string | null;
  rut: string | null;
  es_paciente_ino: boolean | null;
}

interface CitaAgenda {
  id_agenda: number;
  fecha: string;
  hora: string;
}

export function ContactSidebar({ contact, onContactUpdated }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [ficha, setFicha] = useState<FichaInfo | null>(null);
  const [citas, setCitas] = useState<CitaAgenda[]>([]);
  const [ticketCount, setTicketCount] = useState<number | null>(null);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags, and total ticket count in parallel.
    // The count gives a quick "es la 3ra vez que escribe" signal to the
    // agent without needing to open /historial (admin-only).
    const [dealsRes, notesRes, tagsRes, ticketCountRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    setTicketCount(ticketCountRes.count ?? null);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  // Ficha activa del bot de n8n (BotINO) para este telefono -- lectura
  // best-effort desde /api/ino-ficha; si falla o no hay nada, la
  // seccion simplemente no se muestra (ver render mas abajo).
  useEffect(() => {
    if (!contact?.phone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFicha(null);
      setCitas([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/ino-ficha?phone=${encodeURIComponent(contact.phone)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) {
          setFicha(body?.ficha ?? null);
          setCitas(Array.isArray(body?.citas) ? body.citas : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFicha(null);
          setCitas([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contact?.phone]);

  // Actualizar datos reales del contacto (wacrm) desde INO por
  // telefono -- distinto del bloque "Ficha INO" de arriba, que lee el
  // estado de sesion del BOT (botino_analytics). Este botón corrige
  // contacts.name/pac_codigo en wacrm, mismo criterio que el
  // validador del modal de editar contacto y el botón "Revisar y
  // completar" de Contactos: solo aplica si INO reporta EXACTAMENTE
  // un paciente para este teléfono, nunca adivina en casos ambiguos.
  const [refreshingIno, setRefreshingIno] = useState(false);
  type RefreshInoResult = "matched" | "not_found" | "ambiguous" | "error" | null;
  const [refreshInoResult, setRefreshInoResult] = useState<RefreshInoResult>(null);

  const handleRefreshFromIno = useCallback(async () => {
    if (!contact?.phone) return;
    setRefreshingIno(true);
    setRefreshInoResult(null);
    try {
      const res = await fetch(
        `/api/ino-paciente-telefono?phone=${encodeURIComponent(contact.phone)}`
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "error");

      const raw: PacienteTelefonoCandidato[] = body.pacientes ?? [];
      const seen = new Set<string>();
      const unique = raw.filter((p) => {
        if (seen.has(p.pac_codigo)) return false;
        seen.add(p.pac_codigo);
        return true;
      });

      if (unique.length === 0) {
        setRefreshInoResult("not_found");
        return;
      }
      if (unique.length > 1) {
        setRefreshInoResult("ambiguous");
        return;
      }

      const paciente = unique[0];
      const nombreCompleto = [
        paciente.pac_nombre,
        paciente.pac_apellido,
        paciente.pac_apellido_materno,
      ]
        .filter(Boolean)
        .join(" ");

      const supabase = createClient();
      const { error } = await supabase
        .from("contacts")
        .update({
          name: nombreCompleto,
          pac_codigo: paciente.pac_codigo,
          es_paciente_ino: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", contact.id);
      if (error) throw error;

      onContactUpdated?.({
        id: contact.id,
        name: nombreCompleto,
        pac_codigo: paciente.pac_codigo,
      });
      setRefreshInoResult("matched");
    } catch {
      setRefreshInoResult("error");
    } finally {
      setRefreshingIno(false);
    }
  }, [contact, onContactUpdated]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
            {ticketCount !== null && ticketCount > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {ticketCount}ª vez que escribe
              </p>
            )}
            <button
              type="button"
              onClick={handleRefreshFromIno}
              disabled={refreshingIno || !contact.phone}
              className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", refreshingIno && "animate-spin")} />
              {refreshingIno ? "Actualizando..." : "Actualizar desde INO"}
            </button>
            {refreshInoResult === "matched" && (
              <p className="mt-1 text-[11px] text-emerald-500">Datos actualizados.</p>
            )}
            {refreshInoResult === "not_found" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                INO no tiene paciente con este teléfono.
              </p>
            )}
            {refreshInoResult === "ambiguous" && (
              <p className="mt-1 text-[11px] text-amber-500">
                Hay más de un paciente con este teléfono. Usa &quot;Editar contacto&quot; en Contactos para elegir.
              </p>
            )}
            {refreshInoResult === "error" && (
              <p className="mt-1 text-[11px] text-red-400">
                No se pudo consultar INO. Intenta de nuevo.
              </p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Ficha INO (bot de n8n) -- solo si hay algo que mostrar */}
          {ficha && (
            <>
              <div className="my-4 border-t border-border" />
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3 w-3" />
                  Ficha INO
                </div>
                <div className="mt-2 rounded-lg bg-muted px-3 py-2">
                  {ficha.estado === "activa" && ficha.pac_codigo ? (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        {[ficha.pac_nombre, ficha.pac_apellido].filter(Boolean).join(" ") ||
                          "Sin nombre"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Ficha N° {ficha.pac_codigo}
                      </p>
                      {ficha.rut && (
                        <p className="text-xs text-muted-foreground">RUT: {ficha.rut}</p>
                      )}
                      {citas.length > 0 && (
                        <div className="mt-2 border-t border-border/60 pt-2">
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            Citas agendadas
                          </p>
                          <ul className="space-y-1">
                            {citas.map((cita) => {
                              const [year, month, day] = cita.fecha.split("-");
                              return (
                                <li
                                  key={cita.id_agenda}
                                  className="text-xs text-foreground"
                                >
                                  {day}-{month}-{year} · {cita.hora}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : ficha.estado === "seleccionando" ? (
                    <p className="text-xs text-muted-foreground">
                      El paciente está eligiendo entre varias fichas asociadas a este número.
                    </p>
                  ) : ficha.estado === "esperando_rut" ? (
                    <p className="text-xs text-muted-foreground">
                      Número no registrado — el bot está esperando que escriba su RUT.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sin ficha asociada todavía.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
