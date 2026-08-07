"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

/**
 * Ticket-alert + daily business report settings (migration 043).
 * Own fetch/save against `accounts` directly — this panel has 8 fields
 * across two features, too many to add to the global useAuth context
 * like broadcastMessagesPerMinute. Same admin-gating pattern as
 * BroadcastPacingSettings via `canEditSettings` / RLS `accounts_update`.
 */

type Row = {
  ticket_alert_enabled: boolean;
  ticket_alert_threshold_minutes: number;
  ticket_alert_repeat: boolean;
  ticket_alert_repeat_minutes: number;
  ticket_alert_emails: string[];
  daily_report_enabled: boolean;
  daily_report_time: string; // "HH:MM:SS"
  daily_report_emails: string[];
};

function emailsToText(emails: string[]): string {
  return emails.join(", ");
}

function textToEmails(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((e) => e.trim())
    .filter(Boolean);
}

export function TicketAlertsSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<Row | null>(null);

  const [alertEnabled, setAlertEnabled] = useState(true);
  const [thresholdMinutes, setThresholdMinutes] = useState("5");
  const [repeat, setRepeat] = useState(false);
  const [repeatMinutes, setRepeatMinutes] = useState("15");
  const [alertEmails, setAlertEmails] = useState("");

  const [reportEnabled, setReportEnabled] = useState(true);
  const [reportTime, setReportTime] = useState("22:00");
  const [reportEmails, setReportEmails] = useState("");

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("accounts")
        .select(
          "ticket_alert_enabled, ticket_alert_threshold_minutes, ticket_alert_repeat, ticket_alert_repeat_minutes, ticket_alert_emails, daily_report_enabled, daily_report_time, daily_report_emails"
        )
        .eq("id", accountId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        toast.error("No se pudo cargar la configuración de alertas.");
        setLoading(false);
        return;
      }
      const row = data as Row;
      setOriginal(row);
      setAlertEnabled(row.ticket_alert_enabled);
      setThresholdMinutes(String(row.ticket_alert_threshold_minutes));
      setRepeat(row.ticket_alert_repeat);
      setRepeatMinutes(String(row.ticket_alert_repeat_minutes));
      setAlertEmails(emailsToText(row.ticket_alert_emails));
      setReportEnabled(row.daily_report_enabled);
      setReportTime(row.daily_report_time.slice(0, 5));
      setReportEmails(emailsToText(row.daily_report_emails));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const thresholdNum = Number(thresholdMinutes);
  const repeatNum = Number(repeatMinutes);
  const validThreshold = Number.isInteger(thresholdNum) && thresholdNum >= 1 && thresholdNum <= 1440;
  const validRepeat = !repeat || (Number.isInteger(repeatNum) && repeatNum >= 1 && repeatNum <= 1440);
  const validReportTime = /^\d{2}:\d{2}$/.test(reportTime);
  const isValid = validThreshold && validRepeat && validReportTime;

  async function handleSave() {
    if (!accountId || !isValid) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        ticket_alert_enabled: alertEnabled,
        ticket_alert_threshold_minutes: thresholdNum,
        ticket_alert_repeat: repeat,
        ticket_alert_repeat_minutes: repeatNum,
        ticket_alert_emails: textToEmails(alertEmails),
        daily_report_enabled: reportEnabled,
        daily_report_time: `${reportTime}:00`,
        daily_report_emails: textToEmails(reportEmails),
      })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar la configuración.");
      return;
    }
    setOriginal({
      ticket_alert_enabled: alertEnabled,
      ticket_alert_threshold_minutes: thresholdNum,
      ticket_alert_repeat: repeat,
      ticket_alert_repeat_minutes: repeatNum,
      ticket_alert_emails: textToEmails(alertEmails),
      daily_report_enabled: reportEnabled,
      daily_report_time: `${reportTime}:00`,
      daily_report_emails: textToEmails(reportEmails),
    });
    toast.success("Configuración guardada.");
  }

  const dirty =
    !!original &&
    (original.ticket_alert_enabled !== alertEnabled ||
      original.ticket_alert_threshold_minutes !== thresholdNum ||
      original.ticket_alert_repeat !== repeat ||
      original.ticket_alert_repeat_minutes !== repeatNum ||
      emailsToText(original.ticket_alert_emails) !== emailsToText(textToEmails(alertEmails)) ||
      original.daily_report_enabled !== reportEnabled ||
      original.daily_report_time.slice(0, 5) !== reportTime ||
      emailsToText(original.daily_report_emails) !== emailsToText(textToEmails(reportEmails)));

  const disabled = !canEditSettings || profileLoading || loading;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <BellRing className="size-4 text-primary" />
          Alertas de tickets e informe diario
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Aviso a jefatura cuando un ticket queda sin atender, y resumen de negocio al cierre del día.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Alerta de ticket sin atender */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-foreground">Avisar cuando un ticket queda esperando ejecutivo</Label>
            <Switch checked={alertEnabled} onCheckedChange={setAlertEnabled} disabled={disabled} />
          </div>
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">Minutos de espera antes de avisar</Label>
            <Input
              type="number"
              min={1}
              max={1440}
              value={thresholdMinutes}
              onChange={(e) => setThresholdMinutes(e.target.value)}
              disabled={disabled || !alertEnabled}
            />
            {!validThreshold && (
              <p className="text-xs text-destructive">Debe ser un número entero entre 1 y 1440.</p>
            )}
          </div>
          <div className="flex items-center justify-between sm:max-w-xs">
            <Label className="text-muted-foreground">Repetir el aviso si sigue sin atenderse</Label>
            <Switch checked={repeat} onCheckedChange={setRepeat} disabled={disabled || !alertEnabled} />
          </div>
          {repeat && (
            <div className="grid gap-2 sm:max-w-xs">
              <Label className="text-muted-foreground">Repetir cada (minutos)</Label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={repeatMinutes}
                onChange={(e) => setRepeatMinutes(e.target.value)}
                disabled={disabled || !alertEnabled}
              />
              {!validRepeat && (
                <p className="text-xs text-destructive">Debe ser un número entero entre 1 y 1440.</p>
              )}
            </div>
          )}
          <div className="grid gap-2">
            <Label className="text-muted-foreground">Correos de jefatura (separados por coma)</Label>
            <Input
              type="text"
              placeholder="jefatura@ino.cl, supervisor@ino.cl"
              value={alertEmails}
              onChange={(e) => setAlertEmails(e.target.value)}
              disabled={disabled || !alertEnabled}
            />
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Informe nocturno */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-foreground">Enviar informe diario de negocio</Label>
            <Switch checked={reportEnabled} onCheckedChange={setReportEnabled} disabled={disabled} />
          </div>
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">Hora de envío (zona horaria Chile)</Label>
            <Input
              type="time"
              value={reportTime}
              onChange={(e) => setReportTime(e.target.value)}
              disabled={disabled || !reportEnabled}
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">Correos del informe (separados por coma)</Label>
            <Input
              type="text"
              placeholder="jefatura@ino.cl, supervisor@ino.cl"
              value={reportEmails}
              onChange={(e) => setReportEmails(e.target.value)}
              disabled={disabled || !reportEnabled}
            />
          </div>
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
