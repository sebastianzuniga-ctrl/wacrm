'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import {
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, Search, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface FichaCandidato {
  ficha: string;
  nombreCompleto: string;
  telefono: string | null;
  email: string | null;
  estado: string;
}

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  contactTags?: ContactTag[];
  onSaved: () => void;
  /** Open an existing contact's detail view — used by the duplicate
   *  notice to jump to the contact that already owns this number. */
  onViewExisting?: (contactId: string) => void;
}

export function ContactForm({
  open,
  onOpenChange,
  contact,
  contactTags = [],
  onSaved,
  onViewExisting,
}: ContactFormProps) {
  const t = useTranslations('Contacts.form');
  const supabase = createClient();
  const { accountId } = useAuth();
  const isEdit = !!contact;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);

  // Duplicate-phone detection for NEW contacts. `exact` (same digits)
  // hard-blocks the save; a fuzzy trunk-variant match only warns. The
  // DB unique index (migration 022) is the real backstop — this is the
  // friendly heads-up before we get there.
  const [dupMatch, setDupMatch] = useState<
    { contact: ExistingContact; exact: boolean } | null
  >(null);
  const [checkingDup, setCheckingDup] = useState(false);

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  // Búsqueda por número de ficha INO (solo para contactos nuevos).
  // Al elegir un candidato (o su único teléfono) se precargan
  // nombre/teléfono/correo en los campos de abajo -- el admin puede
  // seguir editando antes de crear, igual que si los hubiera tecleado.
  const [ficha, setFicha] = useState('');
  const [fichaSearching, setFichaSearching] = useState(false);
  const [fichaError, setFichaError] = useState<string | null>(null);
  const [fichaResults, setFichaResults] = useState<FichaCandidato[] | null>(null);
  const [manualMode, setManualMode] = useState(false);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setSelectedTagIds(contactTags.map((ct) => ct.tag_id));
      setDupMatch(null);
      setFicha('');
      setFichaError(null);
      setFichaResults(null);
      setManualMode(false);
      fetchTags();
    }
  }, [open, contact]);

  async function handleBuscarFicha() {
    const value = ficha.trim();
    if (!value) return;
    setFichaSearching(true);
    setFichaError(null);
    setFichaResults(null);
    try {
      const res = await fetch(`/api/ino-paciente-ficha?ficha=${encodeURIComponent(value)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Error al buscar');
      setFichaResults(body.pacientes ?? []);
    } catch (err) {
      setFichaError(err instanceof Error ? err.message : t('fichaError'));
    } finally {
      setFichaSearching(false);
    }
  }

  const [updatingExisting, setUpdatingExisting] = useState(false);

  async function handleUpdateExisting() {
    if (!dupMatch) return;
    setUpdatingExisting(true);
    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          name: name.trim() || null,
          email: email.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dupMatch.contact.id);
      if (error) throw error;
      toast.success(t('toastSuccessEdit'));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastError'));
    } finally {
      setUpdatingExisting(false);
    }
  }

  function applyCandidato(candidato: FichaCandidato) {
    setName(candidato.nombreCompleto);
    if (candidato.telefono) setPhone(candidato.telefono);
    if (candidato.email) setEmail(candidato.email);
    if (candidato.telefono) checkDuplicateFor(candidato.telefono);
  }

  // Look up an existing contact with this number (new contacts only).
  // Runs on blur so we don't query on every keystroke. Accepts an
  // explicit value for the case a caller just called setPhone() and
  // can't rely on the `phone` state var being updated yet (React
  // state updates are async) -- e.g. applyCandidato() below.
  async function checkDuplicateFor(value: string) {
    if (isEdit || !accountId) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setDupMatch(null);
      return;
    }
    setCheckingDup(true);
    try {
      const existing = await findExistingContact(supabase, accountId, trimmed);
      setDupMatch(
        existing
          ? { contact: existing, exact: isExactMatch(existing, trimmed) }
          : null,
      );
    } finally {
      setCheckingDup(false);
    }
  }
  function checkDuplicate() {
    return checkDuplicateFor(phone);
  }

  async function fetchTags() {
    setLoadingTags(true);
    const { data } = await supabase
      .from('tags')
      .select('*')
      .order('name');
    if (data) setTags(data);
    setLoadingTags(false);
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!phone.trim()) {
      toast.error(t('phoneRequired'));
      return;
    }

    // Hard-block an exact duplicate on create (the DB unique index is
    // the real backstop; this avoids a round-trip + a raw error toast).
    if (!isEdit && dupMatch?.exact) {
      toast.error(t('toastConflict'));
      return;
    }

    setSaving(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!accountId) throw new Error('Your profile is not linked to an account.');

      let contactId = contact?.id;

      if (isEdit && contactId) {
        const { error } = await supabase
          .from('contacts')
          .update({
            name: name.trim() || null,
            phone: phone.trim(),
            email: email.trim() || null,
            company: company.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', contactId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .insert({
            user_id: user.id,
            account_id: accountId,
            name: name.trim() || null,
            phone: phone.trim(),
            email: email.trim() || null,
            company: company.trim() || null,
          })
          .select('id')
          .single();
        if (error) throw error;
        contactId = data.id;
      }

      // Sync tags
      if (contactId) {
        const existingTagIds = new Set(contactTags.map((tag) => tag.tag_id));
        const desiredTagIds = new Set(selectedTagIds);
        const toRemove = [...existingTagIds].filter((id) => !desiredTagIds.has(id));
        const toAdd = [...desiredTagIds].filter((id) => !existingTagIds.has(id));

        for (const tagId of toRemove) {
          await deleteContactTag(contactId, tagId);
        }
        for (const tagId of toAdd) {
          await addContactTag(contactId, tagId);
        }
      }

      toast.success(isEdit ? t('toastSuccessEdit') : t('toastSuccessAdd'));
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      // The unique index (migration 022) rejects a duplicate phone that
      // slipped past the on-blur check (race, or a format that
      // normalizes equal). Surface it as the friendly duplicate notice
      // and, for new contacts, point the user at the existing record.
      if (isUniqueViolation(err)) {
        toast.error(t('toastConflict'));
        if (!isEdit && accountId) {
          const existing = await findExistingContact(
            supabase,
            accountId,
            phone.trim(),
          );
          if (existing) setDupMatch({ contact: existing, exact: true });
        }
        return;
      }
      const message = err instanceof Error ? err.message : t('toastError');
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? t('editTitle') : t('addTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit
              ? t('editDesc')
              : t('addDesc')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && !manualMode && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <Label htmlFor="cf-ficha" className="text-muted-foreground">
                {t('fichaLabel')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="cf-ficha"
                  value={ficha}
                  onChange={(e) => setFicha(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBuscarFicha();
                    }
                  }}
                  placeholder={t('fichaPlaceholder')}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <Button
                  type="button"
                  onClick={handleBuscarFicha}
                  disabled={fichaSearching || !ficha.trim()}
                  className="shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {fichaSearching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  {fichaSearching ? t('fichaSearching') : t('fichaSearch')}
                </Button>
              </div>

              {fichaError && (
                <p className="text-xs text-red-400">{fichaError}</p>
              )}

              {fichaResults && fichaResults.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('fichaNotFound')}</p>
              )}

              {fichaResults && fichaResults.length > 0 && (
                <div className="space-y-1.5">
                  {fichaResults.length > 1 && (
                    <p className="text-xs text-muted-foreground">{t('fichaSelectPhone')}</p>
                  )}
                  {fichaResults.map((candidato, idx) => (
                    <button
                      key={`${candidato.ficha}-${candidato.telefono ?? idx}`}
                      type="button"
                      onClick={() => applyCandidato(candidato)}
                      disabled={!candidato.telefono}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div>
                        <p className="font-medium text-foreground">{candidato.nombreCompleto}</p>
                        <p className="text-xs text-muted-foreground">
                          {candidato.telefono ?? t('fichaNoPhone')}
                          {candidato.email ? ` · ${candidato.email}` : ''}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          candidato.estado === 'ACT'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : candidato.estado === 'TMP'
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-muted-foreground/15 text-muted-foreground'
                        }`}
                      >
                        {candidato.estado === 'ACT'
                          ? t('fichaEstadoActivo')
                          : candidato.estado === 'TMP'
                            ? t('fichaEstadoTemporal')
                            : t('fichaEstadoInactivo')}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {name && phone && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-500">
                  <CheckCircle2 className="size-3.5" />
                  {name}
                </p>
              )}

              <button
                type="button"
                onClick={() => setManualMode(true)}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {t('fichaUseManual')}
              </button>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="cf-name" className="text-muted-foreground">
              {t('nameLabel')}
            </Label>
            <Input
              id="cf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-phone" className="text-muted-foreground">
              {t('phoneLabel')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="cf-phone"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (dupMatch) setDupMatch(null);
              }}
              onBlur={checkDuplicate}
              placeholder={t('phonePlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            {dupMatch ? (
              <div
                className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                  dupMatch.exact
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                }`}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <div className="space-y-1">
                  <p>
                    {dupMatch.exact
                      ? t('dupExact')
                      : t('dupSimilar')}
                  </p>
                  {onViewExisting && (
                    <button
                      type="button"
                      onClick={() => onViewExisting(dupMatch.contact.id)}
                      className="font-medium underline underline-offset-2 hover:no-underline"
                    >
                      {t('viewExisting', { name: dupMatch.contact.name || dupMatch.contact.phone })}
                    </button>
                  )}
                  {dupMatch.exact && fichaResults && (
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleUpdateExisting}
                        disabled={updatingExisting}
                        className="mt-1 h-7 border-red-500/40 text-red-300 hover:bg-red-500/10"
                      >
                        {updatingExisting && <Loader2 className="size-3 animate-spin" />}
                        {t('updateExisting')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('phoneHint')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-email" className="text-muted-foreground">
              {t('emailLabel')}
            </Label>
            <Input
              id="cf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-company" className="text-muted-foreground">
              {t('companyLabel')}
            </Label>
            <Input
              id="cf-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t('companyPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('tagsLabel')}</Label>
            {loadingTags ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="size-3 animate-spin" />
                {t('loadingTags')}
              </div>
            ) : tags.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('noTagsAvailable')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'ring-2 ring-primary ring-offset-1 ring-offset-border'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: tag.color + '20',
                        color: tag.color,
                        borderColor: tag.color,
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={saving || checkingDup || (!isEdit && !!dupMatch?.exact)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? t('update') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
