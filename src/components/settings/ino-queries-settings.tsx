"use client";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Database, Loader2, Save } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface InoQuery {
  id: string;
  key: string;
  label: string;
  description: string | null;
  sql_template: string;
  updated_at: string;
}

/**
 * Lista y edición de las consultas SQL crudas que wacrm envía a
 * sistema.ino.cl (queryGptJson.jsp). Ver src/lib/ino/citas.ts y
 * migración 050_ino_queries.sql.
 *
 * Admin-only por el propio endpoint (requireRole('admin')) -- no hay
 * RLS pública sobre ino_queries, así que un rol insuficiente
 * simplemente recibe 403 del API.
 */
export function InoQueriesSettings() {
  const { canEditSettings, profileLoading } = useAuth();
  const [queries, setQueries] = useState<InoQuery[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/ino-queries");
      if (res.ok) {
        const body = await res.json();
        const list: InoQuery[] = body?.queries ?? [];
        setQueries(list);
        setDrafts(Object.fromEntries(list.map((q) => [q.id, q.sql_template])));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(query: InoQuery) {
    const draft = drafts[query.id]?.trim();
    if (!draft || draft === query.sql_template) return;
    setSavingId(query.id);
    const res = await fetch(`/api/settings/ino-queries/${query.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql_template: draft }),
    });
    setSavingId(null);
    if (!res.ok) {
      toast.error("No se pudo guardar la query.");
      return;
    }
    toast.success("Query actualizada.");
    load();
  }

  if (loading || profileLoading) {
    return (
      <Card className="mt-6">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando querys...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Database className="size-4" />
        Consultas SQL enviadas al endpoint queryGptJson.jsp de sistema.ino.cl.
        Editar con cuidado — un error de sintaxis rompe la funcionalidad
        asociada de inmediato, sin validación previa contra la base real.
      </div>

      {queries.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No hay queries configuradas todavía.
          </CardContent>
        </Card>
      )}

      {queries.map((q) => {
        const dirty = drafts[q.id] !== q.sql_template;
        return (
          <Card key={q.id}>
            <CardHeader>
              <CardTitle className="text-foreground">{q.label}</CardTitle>
              {q.description && (
                <CardDescription className="text-muted-foreground">
                  {q.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={drafts[q.id] ?? ""}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))
                }
                disabled={!canEditSettings}
                rows={4}
                className="font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Clave interna: <code>{q.key}</code>
                </p>
                {canEditSettings && (
                  <Button
                    size="sm"
                    onClick={() => handleSave(q)}
                    disabled={!dirty || savingId === q.id}
                  >
                    {savingId === q.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    Guardar
                  </Button>
                )}
              </div>
              {!canEditSettings && (
                <p className="text-xs text-muted-foreground">
                  Solo administradores pueden editar esto.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
