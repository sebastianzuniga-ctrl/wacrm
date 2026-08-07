"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * Horario de atención para derivación a ejecutiva (migration 045).
 * Si un handoff cae fuera de este horario, el bot NO pausa ni deriva —
 * responde con business_hours_closed_message y sigue conversando
 * (ver src/lib/ai/auto-reply.ts + src/lib/ino/business-hours.ts).
 * Mismo patrón de fetch/save directo contra `accounts` que
 * TicketAlertsSettings.
 */

type Row = {
  business_hours_enabled: boolean;
  business_hours_days: number[];
  business_hours_start: string; // "HH:MM:SS"
  business_hours_end: string;
  business_hours_closed_message: string;
};

const DAYS: { iso: number; label: string }[] = [
  { iso: 1, label: "Lun" },
  { iso: 2, label: "Mar" },
  { iso: 3, label: "Mié" },
  { iso: 4, label: "Jue" },
  { iso: 5, label: "Vie" },
  { iso: 6, label: "Sáb" },
  { iso: 7, label: "Dom" },
];

function sortedDays(days: number[]): number[] {
  return [...days].sort((a, b) => a - b);
}

export function BusinessHoursSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<Row | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("19:00");
  const [closedMessage, setClosedMessage] = useState("");

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("accounts")
        .select(
          "business_hours_enabled, business_hours_days, business_hours_start, business_hours_end, business_hours_closed_message"
        )
        .eq("id", accountId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        toast.error("No se pudo cargar el horario de atención.");
        setLoading(false);
        return;
      }
      const row = data as Row;
      setOriginal(row);
      setEnabled(row.business_hours_enabled);
      setDays(sortedDays(row.business_hours_days));
      setStart(row.business_hours_start.slice(0, 5));
      setEnd(row.business_hours_end.slice(0, 5));
      setClosedMessage(row.business_hours_closed_message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  function toggleDay(iso: number) {
    setDays((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : sortedDays([...prev, iso])
    );
  }

  const validTimes = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end;
  const validDays = days.length > 0;
  const validMessage = closedMessage.trim().length > 0;
  const isValid = validTimes && validDays && validMessage;

  async function handleSave() {
    if (!accountId || !isValid) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        business_hours_enabled: enabled,
        business_hours_days: days,
        business_hours_start: `${start}:00`,
        business_hours_end: `${end}:00`,
        business_hours_closed_message: closedMessage.trim(),
      })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar el horario de atención.");
      return;
    }
    setOriginal({
      business_hours_enabled: enabled,
      business_hours_days: days,
      business_hours_start: `${start}:00`,
      business_hours_end: `${end}:00`,
      business_hours_closed_message: closedMessage.trim(),
    });
    toast.success("Horario de atención guardado.");
  }

  const dirty =
    !!original &&
    (original.business_hours_enabled !== enabled ||
      sortedDays(original.business_hours_days).join(",") !== days.join(",") ||
      original.business_hours_start.slice(0, 5) !== start ||
      original.business_hours_end.slice(0, 5) !== end ||
      original.business_hours_closed_message !== closedMessage.trim());

  const disabled = !canEditSettings || profileLoading || loading;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Clock className="size-4 text-primary" />
          Horario de atención (derivación a ejecutiva)
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Si un cliente pide hablar con un ejecutivo fuera de este horario, el bot no deriva el ticket — responde con el mensaje configurado y sigue atendiendo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label className="text-foreground">Restringir derivación a horario de atención</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={disabled} />
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">Días con ejecutivos disponibles</Label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <button
                key={d.iso}
                type="button"
                onClick={() => toggleDay(d.iso)}
                disabled={disabled || !enabled}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  days.includes(d.iso)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-transparent text-muted-foreground"
                } disabled:opacity-50`}
              >
                {d.label}
              </button>
            ))}
          </div>
          {!validDays && (
            <p className="text-xs text-destructive">Selecciona al menos un día.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 sm:max-w-md">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">Hora de inicio</Label>
            <Input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={disabled || !enabled}
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">Hora de término</Label>
            <Input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              disabled={disabled || !enabled}
            />
          </div>
        </div>
        {!validTimes && (
          <p className="text-xs text-destructive">La hora de término debe ser posterior a la de inicio.</p>
        )}

        <div className="grid gap-2">
          <Label className="text-muted-foreground">Mensaje cuando no hay ejecutivos disponibles</Label>
          <Textarea
            value={closedMessage}
            onChange={(e) => setClosedMessage(e.target.value)}
            disabled={disabled || !enabled}
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
