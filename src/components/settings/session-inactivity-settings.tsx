"use client";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Clock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

/**
 * Config de app_settings.session_inactivity_hours (migration 054).
 * Controla cuánto tiempo de inactividad tolera el middleware antes de
 * forzar logout (ver src/middleware.ts). El middleware cachea el
 * valor hasta 60s, así que el cambio no es instantáneo.
 *
 * Escritura vía RLS directo (misma convención que
 * WebhookHmacToggleSettings): la policy "Admins can update
 * app_settings" ya restringe el UPDATE a account_role = 'admin'.
 */
export function SessionInactivitySettings() {
  const supabase = createClient();
  const { canEditSettings, profileLoading } = useAuth();
  const [hours, setHours] = useState<string>("12");
  const [savedHours, setSavedHours] = useState<number>(12);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "session_inactivity_hours")
      .maybeSingle();
    if (!error && data && typeof data.value === "number") {
      setHours(String(data.value));
      setSavedHours(data.value);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleSave() {
    const parsed = Number(hours);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 720) {
      toast.error("Ingresa un número de horas entre 1 y 720.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({ value: parsed, updated_at: new Date().toISOString() })
      .eq("key", "session_inactivity_hours");
    if (error) {
      toast.error("No se pudo guardar el cambio.");
      setSaving(false);
      return;
    }
    setSavedHours(parsed);
    setSaving(false);
    toast.success(
      `Sesión inactiva se cerrará tras ${parsed} hora${parsed === 1 ? "" : "s"}. Puede tardar hasta 60s en aplicarse.`
    );
  }

  if (loading || profileLoading) return null;

  const dirty = Number(hours) !== savedHours;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Clock className="size-4 text-primary" />
          Cierre de sesión por inactividad
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Los usuarios se desloguean automáticamente tras este número de
          horas sin actividad. El cambio puede tardar hasta 60 segundos en
          aplicarse (cache del servidor).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="inactivity-hours" className="text-muted-foreground">
              Horas de inactividad
            </Label>
            <Input
              id="inactivity-hours"
              type="number"
              min={1}
              max={720}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              disabled={!canEditSettings || saving}
              className="w-32"
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={!canEditSettings || saving || !dirty}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Guardar"
            )}
          </Button>
        </div>
        {!canEditSettings && (
          <p className="text-xs text-muted-foreground">
            Solo administradores pueden cambiar esta opción.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
