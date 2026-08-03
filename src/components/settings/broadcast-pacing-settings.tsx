"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Gauge, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";

const MIN_PER_MINUTE = 1;
const MAX_PER_MINUTE = 4800;

/**
 * Broadcast pacing settings — account-wide messages/minute cap for
 * campaign sends. Lives on the WhatsApp settings page since it's
 * about outbound send behaviour, not a broadcast-specific nav item.
 *
 * Writes go straight to `accounts.broadcast_messages_per_minute`
 * (migration 039); the `accounts_update` RLS policy (017) already
 * restricts that to admins+, so non-admins see a disabled, read-only
 * control — mirrors DealsSettings.
 */
export function BroadcastPacingSettings() {
  const supabase = createClient();
  const {
    accountId,
    broadcastMessagesPerMinute,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();
  const [value, setValue] = useState(String(broadcastMessagesPerMinute));
  const [saving, setSaving] = useState(false);
  const t = useTranslations("Settings.broadcastPacing");

  useEffect(() => {
    setValue(String(broadcastMessagesPerMinute));
  }, [broadcastMessagesPerMinute]);

  const parsed = Number(value);
  const isValidValue =
    Number.isInteger(parsed) && parsed >= MIN_PER_MINUTE && parsed <= MAX_PER_MINUTE;
  const dirty = parsed !== broadcastMessagesPerMinute;

  async function handleSave() {
    if (!accountId || !dirty || !isValidValue) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({ broadcast_messages_per_minute: parsed })
      .eq("id", accountId);
    if (error) {
      toast.error(t("saveFailed"));
      setSaving(false);
      return;
    }
    await refreshProfile();
    setSaving(false);
    toast.success(t("saveSuccess"));
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Gauge className="size-4 text-primary" />
          {t("title")}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:max-w-xs">
          <Label className="text-muted-foreground">{t("fieldLabel")}</Label>
          <Input
            type="number"
            min={MIN_PER_MINUTE}
            max={MAX_PER_MINUTE}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canEditSettings || profileLoading}
          />
          {!isValidValue && (
            <p className="text-xs text-destructive">
              {t("rangeHint", { min: MIN_PER_MINUTE, max: MAX_PER_MINUTE })}
            </p>
          )}
          {!canEditSettings && (
            <p className="text-xs text-muted-foreground">{t("adminOnlyHint")}</p>
          )}
        </div>
        {canEditSettings && (
          <Button
            onClick={handleSave}
            disabled={saving || !dirty || !isValidValue}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
