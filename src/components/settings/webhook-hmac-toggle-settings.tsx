"use client";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

/**
 * Toggle for whatsapp_config.webhook_hmac_enabled (migration 049).
 * Lives on the WhatsApp settings page. Writes go straight to
 * `whatsapp_config` via the RLS-scoped client — the existing
 * `whatsapp_config_update` policy already restricts writes to
 * admins+, so non-admins see a disabled, read-only control (mirrors
 * BroadcastPacingSettings / DealsSettings).
 *
 * Defaults to enabled (secure). Should only be turned off temporarily
 * when a trusted intermediary can't reproduce Meta's original HMAC
 * signature (see wacrm_add4.md/add5.md — the n8n forwarding
 * workaround). Turn back on as soon as the direct Meta webhook is
 * reconnected.
 */
export function WebhookHmacToggleSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const [configId, setConfigId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_config")
      .select("id, webhook_hmac_enabled")
      .eq("account_id", accountId)
      .maybeSingle();
    if (!error && data) {
      setConfigId(data.id);
      setEnabled(data.webhook_hmac_enabled ?? true);
    }
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleToggle(next: boolean) {
    if (!configId) return;
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_config")
      .update({ webhook_hmac_enabled: next })
      .eq("id", configId);
    if (error) {
      toast.error("No se pudo guardar el cambio.");
      setSaving(false);
      return;
    }
    setEnabled(next);
    setSaving(false);
    toast.success(
      next
        ? "Validación de firma HMAC activada."
        : "Validación de firma HMAC desactivada — el webhook aceptará payloads sin verificar. Reactivar apenas se resuelva el flujo directo con Meta."
    );
  }

  if (loading || profileLoading) return null;
  if (!configId) return null; // no hay config de WhatsApp guardada todavía

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          {enabled ? (
            <ShieldCheck className="size-4 text-primary" />
          ) : (
            <ShieldAlert className="size-4 text-destructive" />
          )}
          Validación de firma del webhook (HMAC)
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Cuando está activa, el webhook rechaza cualquier payload cuya firma
          no coincida con la de Meta. Desactivarla es un riesgo de seguridad
          conocido — solo debería estar apagada mientras el flujo pase por un
          reenvío intermedio (ej. n8n) que no puede reproducir la firma
          original.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={!canEditSettings || saving}
          />
          <Label className="text-muted-foreground">
            {enabled ? "Activada (recomendado)" : "Desactivada"}
          </Label>
          {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {!enabled && (
          <p className="text-xs text-destructive">
            El endpoint público acepta payloads sin autenticar mientras esto
            esté apagado. No dejar así indefinidamente.
          </p>
        )}
        {!canEditSettings && (
          <p className="text-xs text-muted-foreground">
            Solo administradores pueden cambiar esta opción.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
