"use client";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { CUSTOM_PROFILE_MENU_ITEMS } from "@/lib/auth/menu-items";
import type { AccountMember } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CustomProfile {
  id: string;
  name: string;
  base_role: "admin" | "agent";
  allowed_pages: string[];
  created_at: string;
}

export function CustomProfilesPanel() {
  const t = useTranslations("Settings.customProfiles");
  const tSidebar = useTranslations("Sidebar");
  const { canEditSettings } = useAuth();

  const [profiles, setProfiles] = useState<CustomProfile[] | null>(null);
  const [members, setMembers] = useState<AccountMember[] | null>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<CustomProfile | null | "new">(null);
  const [formName, setFormName] = useState("");
  const [formBaseRole, setFormBaseRole] = useState<"admin" | "agent">("agent");
  const [formPages, setFormPages] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CustomProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [assigningUserId, setAssigningUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesRes, membersRes] = await Promise.all([
        fetch("/api/settings/custom-profiles"),
        fetch("/api/account/members"),
      ]);
      const profilesBody = await profilesRes.json().catch(() => ({}));
      const membersBody = await membersRes.json().catch(() => ({}));
      if (profilesRes.ok) setProfiles(profilesBody.profiles ?? []);
      if (membersRes.ok) setMembers(membersBody.members ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function openCreate() {
    setFormName("");
    setFormBaseRole("agent");
    setFormPages(new Set());
    setEditing("new");
  }

  function openEdit(profile: CustomProfile) {
    setFormName(profile.name);
    setFormBaseRole(profile.base_role);
    setFormPages(new Set(profile.allowed_pages));
    setEditing(profile);
  }

  function togglePage(href: string) {
    setFormPages((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  async function handleSave() {
    const name = formName.trim();
    if (!name) {
      toast.error(t("nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const isNew = editing === "new";
      const url = isNew
        ? "/api/settings/custom-profiles"
        : `/api/settings/custom-profiles/${(editing as CustomProfile).id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          base_role: formBaseRole,
          allowed_pages: Array.from(formPages),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t("saveError"));
      toast.success(isNew ? t("createdSuccess") : t("updatedSuccess"));
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/settings/custom-profiles/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t("deleteError"));
      toast.success(t("deletedSuccess"));
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteError"));
    } finally {
      setDeleting(false);
    }
  }

  async function handleAssign(userId: string, customProfileId: string | null) {
    setAssigningUserId(userId);
    try {
      const res = await fetch(`/api/account/members/${userId}/custom-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custom_profile_id: customProfileId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t("assignError"));
      toast.success(t("assignedSuccess"));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("assignError"));
    } finally {
      setAssigningUserId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <ShieldCheck className="size-4 text-primary" />
              {t("title")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("description")}
            </CardDescription>
          </div>
          {canEditSettings && (
            <Button onClick={openCreate} size="sm">
              <Plus className="size-4" />
              {t("newProfile")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!profiles || profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noProfiles")}</p>
          ) : (
            <div className="space-y-2">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <div>
                    <p className="font-medium text-foreground">{profile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("baseRoleLabel")}: {profile.base_role === "admin" ? t("roleAdmin") : t("roleAgent")}
                      {" · "}
                      {t("pagesCount", { count: profile.allowed_pages.length })}
                    </p>
                  </div>
                  {canEditSettings && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(profile)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeleteTarget(profile)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canEditSettings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t("assignTitle")}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("assignDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!members || members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{member.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                    </div>
                    <Select
                      value={member.custom_profile_id ?? "__none__"}
                      onValueChange={(v) =>
                        handleAssign(member.user_id, v === "__none__" ? null : v)
                      }
                      disabled={assigningUserId === member.user_id}
                    >
                      <SelectTrigger className="w-48 shrink-0">
                        <SelectValue>
                          {(value: string) =>
                            value === "__none__" || !value
                              ? t("noProfileAssigned")
                              : (profiles ?? []).find((p) => p.id === value)?.name ?? value
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("noProfileAssigned")}</SelectItem>
                        {(profiles ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Crear / editar perfil */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("newProfile") : t("editProfile")}</DialogTitle>
            <DialogDescription>{t("formDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("nameLabel")}</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t("namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("baseRoleLabel")}</Label>
              <Select value={formBaseRole} onValueChange={(v) => setFormBaseRole(v as "admin" | "agent")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">{t("roleAgent")}</SelectItem>
                  <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("baseRoleHint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("pagesLabel")}</Label>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
                {CUSTOM_PROFILE_MENU_ITEMS.map((item) => (
                  <label key={item.href} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formPages.has(item.href)}
                      onCheckedChange={() => togglePage(item.href)}
                    />
                    {tSidebar(item.labelKey)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar borrado */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirm", { name: deleteTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
