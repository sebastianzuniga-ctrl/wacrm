"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Star, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

/**
 * Encuesta de satisfacción post-atención (migration 048). Se manda
 * automáticamente al cerrar manualmente un ticket desde el inbox (ver
 * message-thread.tsx handleStatusChange -> /api/conversations/[id]/send-survey).
 * Apagada por defecto - feature completa, a la espera de que jefatura
 * decida si activarla.
 */

type Row = {
  satisfaction_survey_enabled: boolean;
  satisfaction_survey_message: string;
};

export function SatisfactionSurveySettings() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<Row | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("accounts")
        .select("satisfaction_survey_enabled, satisfaction_survey_message")
        .eq("id", accountId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        toast.error("No se pudo cargar la configuración de encuesta.");
        setLoading(false);
        return;
      }
      const row = data as Row;
      setOriginal(row);
      setEnabled(row.satisfaction_survey_enabled);
      setMessage(row.satisfaction_survey_message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const validMessage = message.trim().length > 0;
  const isValid = validMessage;

  async function handleSave() {
    if (!accountId || !isValid) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        satisfaction_survey_enabled: enabled,
        satisfaction_survey_message: message.trim(),
      })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar la configuración.");
      return;
    }
    setOriginal({
      satisfaction_survey_enabled: enabled,
      satisfaction_survey_message: message.trim(),
    });
    toast.success("Configuración guardada.");
  }

  const dirty =
    !!original &&
    (original.satisfaction_survey_enabled !== enabled ||
      original.satisfaction_survey_message !== message.trim());

  const disabled = !canEditSettings || profileLoading || loading;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Star className="size-4 text-primary" />
          Encuesta de satisfacción
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Al cerrar manualmente un ticket desde el inbox, se manda automáticamente
          una encuesta de 1 a 5 estrellas por WhatsApp. No se envía en cierres
          automáticos (inactividad de 24h, fin de horario de atención).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label className="text-foreground">Enviar encuesta al cerrar un ticket</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={disabled} />
        </div>

        <div className="grid gap-2">
          <Label className="text-muted-foreground">Mensaje de la encuesta</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={disabled}
            rows={3}
          />
          {!validMessage && (
            <p className="text-xs text-destructive">El mensaje no puede estar vacío.</p>
          )}
        </div>

        {!canEditSettings && (
          <p className="text-xs text-muted-foreground">Solo administradores pueden editar esta configuración.</p>
        )}

        {canEditSettings && (
          <Button
            onClick={handleSave}
            disabled={saving || !dirty || !isValid || loading}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando...
              </>
            ) : (
              "Guardar"
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
