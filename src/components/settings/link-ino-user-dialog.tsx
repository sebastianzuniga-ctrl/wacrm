'use client';

// ============================================================
// LinkInoUserDialog
//
// Alternative to InviteMemberDialog: instead of an invite link the
// person accepts, the admin directly registers a login from the
// internal INO system (login_ino). No invite-accept step -- the
// person logs in with their INO credentials the first time and
// wacrm links up automatically (see /api/auth/ino-login).
//
// The admin never sees or handles the person's real password --
// only their INO `login`, full name, and the wacrm role to grant.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';

type InoLinkRole = 'admin' | 'agent' | 'viewer';

interface LinkInoUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

// Normaliza "Sebastián Zúñiga" -> "sebastian.zuniga", quitando tildes,
// ñ->n, y usando primera + última palabra del nombre completo. El
// admin puede editar el resultado a mano si hay colisión entre dos
// personas con nombres similares.
function suggestEmailLocalPart(fullName: string): string {
  const normalized = fullName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[^a-zA-Z\s]/g, '') // quita cualquier otro caracter raro
    .trim()
    .toLowerCase();
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}.${parts[parts.length - 1]}`;
}

export function LinkInoUserDialog({
  open,
  onOpenChange,
  onCreated,
}: LinkInoUserDialogProps) {
  const t = useTranslations('Settings.invite');
  const tRoles = useTranslations('Settings.roles');
  const [loginIno, setLoginIno] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [emailEdited, setEmailEdited] = useState(false);
  const [role, setRole] = useState<InoLinkRole>('agent');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setLoginIno('');
    setFullName('');
    setEmail('');
    setEmailEdited(false);
    setRole('agent');
    setSubmitting(false);
  }

  function handleFullNameChange(value: string) {
    setFullName(value);
    // Solo auto-sugerir mientras el admin no haya tocado el campo de
    // email a mano -- una vez que lo edita, dejamos de sobreescribirlo.
    if (!emailEdited) {
      const local = suggestEmailLocalPart(value);
      setEmail(local ? `${local}@ino.cl` : '');
    }
  }

  async function handleCreate() {
    if (!loginIno.trim() || !fullName.trim() || !email.trim()) {
      toast.error('Completa login, nombre y correo.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/link-ino-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login_ino: loginIno.trim(),
          full_name: fullName.trim(),
          email: email.trim(),
          role,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo vincular el usuario.');
        return;
      }

      toast.success(`${fullName.trim()} ya puede iniciar sesión con su login de INO.`);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      console.error('[LinkInoUserDialog] create error:', err);
      toast.error('No se pudo contactar al servidor. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <Link2 className="size-4 text-primary" />
            Vincular usuario INO
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            La persona podrá iniciar sesión con su login y clave del sistema
            INO. No necesitas conocer ni ingresar su contraseña real.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">Login de INO</Label>
            <Input
              placeholder="szuniga"
              value={loginIno}
              onChange={(e) => setLoginIno(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Nombre completo</Label>
            <Input
              placeholder="Sebastian Zuniga"
              value={fullName}
              onChange={(e) => handleFullNameChange(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              Correo interno{' '}
              <span className="text-xs text-muted-foreground">(editable)</span>
            </Label>
            <Input
              placeholder="nombre.apellido@ino.cl"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailEdited(true);
              }}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Sugerido automáticamente desde el nombre. Ajústalo si hay
              colisión con otra persona.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('roleLabel')}</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as InoLinkRole)}>
              <SelectTrigger className="w-full bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {tRoles(`${role}Hint` as 'adminHint' | 'agentHint' | 'viewerHint')}
            </p>
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Vinculando...
              </>
            ) : (
              'Vincular usuario'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
