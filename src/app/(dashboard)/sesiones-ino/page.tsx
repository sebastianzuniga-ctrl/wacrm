"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Search,
  Pencil,
  Trash2,
  Save,
  X,
  Database,
  Wand2,
  Plus,
} from "lucide-react";
import { AdminGate } from "@/components/auth/admin-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface SesionRow {
  wa_id: string;
  pac_codigo: string | null;
  pac_nombre: string | null;
  pac_apellido: string | null;
  pacientes_lista: string | null;
  historial: string | null;
  updated_at: string;
}

type EstadoOpcion = "activo" | "seleccionando" | "esperando_rut" | "sin_codigo";

function estadoFromPacCodigo(pacCodigo: string | null): EstadoOpcion {
  if (pacCodigo === "SELECCIONANDO") return "seleccionando";
  if (pacCodigo === "ESPERANDO_RUT") return "esperando_rut";
  if (pacCodigo && pacCodigo.trim()) return "activo";
  return "sin_codigo";
}

interface PacienteCandidato {
  pac_codigo: string;
  pac_nombre: string;
  pac_apellido: string;
  pac_apellido_materno: string | null;
}

interface EditForm {
  estado: EstadoOpcion;
  codigoReal: string;
  pac_nombre: string;
  pac_apellido: string;
  pacientes_lista: string;
}

function formToPacCodigo(form: EditForm): string | null {
  if (form.estado === "seleccionando") return "SELECCIONANDO";
  if (form.estado === "esperando_rut") return "ESPERANDO_RUT";
  if (form.estado === "activo") return form.codigoReal.trim() || null;
  return null;
}

function SesionesInoPageInner() {
  const [sesiones, setSesiones] = useState<SesionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [buscandoEnIno, setBuscandoEnIno] = useState(false);
  const [candidatos, setCandidatos] = useState<PacienteCandidato[] | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newWaId, setNewWaId] = useState("");

  const load = useCallback(async (searchTerm?: string) => {
    setLoading(true);
    try {
      const params = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : "";
      const res = await fetch(`/api/settings/ino-sesiones${params}`);
      if (res.ok) {
        const body = await res.json();
        setSesiones(body?.sesiones ?? []);
      } else {
        toast.error("No se pudieron cargar las sesiones.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startCreate() {
    setCreatingNew(true);
    setNewWaId("");
    setCandidatos(null);
    setForm({
      estado: "sin_codigo",
      codigoReal: "",
      pac_nombre: "",
      pac_apellido: "",
      pacientes_lista: "",
    });
  }

  function cancelCreate() {
    setCreatingNew(false);
    setNewWaId("");
    setForm(null);
    setCandidatos(null);
  }

  async function saveNew() {
    if (!form) return;
    const waId = newWaId.trim();
    if (!/^\d{6,20}$/.test(waId)) {
      toast.error("El teléfono debe ser solo dígitos (6 a 20 caracteres).");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/ino-sesiones/${encodeURIComponent(waId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pac_codigo: formToPacCodigo(form),
          pac_nombre: form.pac_nombre,
          pac_apellido: form.pac_apellido,
          pacientes_lista: form.pacientes_lista,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ?? "No se pudo crear la sesión.");
        return;
      }
      toast.success("Sesión creada.");
      cancelCreate();
      load(search);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: SesionRow) {
    setEditingId(row.wa_id);
    setCandidatos(null);
    setForm({
      estado: estadoFromPacCodigo(row.pac_codigo),
      codigoReal: estadoFromPacCodigo(row.pac_codigo) === "activo" ? row.pac_codigo ?? "" : "",
      pac_nombre: row.pac_nombre ?? "",
      pac_apellido: row.pac_apellido ?? "",
      pacientes_lista: row.pacientes_lista ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(null);
    setCandidatos(null);
  }

  // Selecciona un candidato de la lista de "Buscar en INO" y rellena
  // el formulario con sus datos -- deja pacientes_lista con SOLO ese
  // candidato (ya resuelto), no la lista completa de posibles matches.
  function seleccionarCandidato(p: PacienteCandidato) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            estado: "activo",
            codigoReal: p.pac_codigo,
            pac_nombre: p.pac_nombre,
            pac_apellido: p.pac_apellido,
            pacientes_lista: JSON.stringify([
              {
                PAC_CODIGO: Number(p.pac_codigo),
                PAC_NOMBRES: p.pac_nombre,
                PAC_APELLIDO_PATERNO: p.pac_apellido,
                PAC_APELLIDO_MATERNO: p.pac_apellido_materno,
              },
            ]),
          }
        : prev,
    );
    setCandidatos(null);
  }

  // Busca en INO (DENT) por telefono y rellena el formulario si
  // encuentra un unico candidato exacto. Si hay varios, los deja en
  // pacientes_lista (igual que haria el bot) y avisa que hay que
  // elegir manualmente -- no adivina cual es el correcto.
  async function buscarEnIno(waId: string) {
    setBuscandoEnIno(true);
    setCandidatos(null);
    try {
      const res = await fetch(`/api/settings/ino-sesiones/buscar-paciente?wa_id=${encodeURIComponent(waId)}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ?? "No se pudo buscar en INO.");
        return;
      }
      const body = await res.json();
      const pacientes: PacienteCandidato[] = body?.pacientes ?? [];

      if (pacientes.length === 0) {
        toast.error("No se encontró ningún paciente con ese teléfono en INO.");
        return;
      }

      if (pacientes.length === 1) {
        seleccionarCandidato(pacientes[0]);
        toast.success(`Encontrado: ${pacientes[0].pac_nombre} ${pacientes[0].pac_apellido} (${pacientes[0].pac_codigo})`);
      } else {
        setCandidatos(pacientes);
        toast.success(`Se encontraron ${pacientes.length} candidatos -- elige el correcto abajo.`);
      }
    } finally {
      setBuscandoEnIno(false);
    }
  }

  async function saveEdit(waId: string) {
    if (!form) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/ino-sesiones/${encodeURIComponent(waId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pac_codigo: formToPacCodigo(form),
          pac_nombre: form.pac_nombre,
          pac_apellido: form.pac_apellido,
          pacientes_lista: form.pacientes_lista,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ?? "No se pudo guardar.");
        return;
      }
      toast.success("Sesión actualizada.");
      cancelEdit();
      load(search);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(waId: string) {
    if (!confirm(`¿Eliminar la sesión de ${waId}? Esta acción no se puede deshacer.`)) return;
    setDeletingId(waId);
    try {
      const res = await fetch(`/api/settings/ino-sesiones/${encodeURIComponent(waId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ?? "No se pudo eliminar.");
        return;
      }
      toast.success("Sesión eliminada.");
      load(search);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Database className="h-5 w-5" />
          Sesiones INO (bot de n8n)
        </h1>
        <p className="text-sm text-muted-foreground">
          Edición manual de la tabla <code>sesiones</code> en{" "}
          <code>botino_analytics</code> — la base que usa el bot BotINO
          Principal para saber a qué paciente corresponde cada número. Usar
          con cuidado: n8n también escribe esta tabla en tiempo real.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Buscar por teléfono, nombre, apellido o código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load(search);
          }}
        />
        <Button variant="outline" onClick={() => load(search)} disabled={loading}>
          <Search className="h-4 w-4" />
        </Button>
        {!creatingNew && (
          <Button onClick={startCreate}>
            <Plus className="h-4 w-4" />
            Agregar sesión nueva
          </Button>
        )}
      </div>

      {creatingNew && form && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-foreground">Nueva sesión</CardTitle>
            <CardDescription>
              Para un número que el bot todavía no tiene registrado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Teléfono (wa_id, solo dígitos)</Label>
              <Input
                value={newWaId}
                onChange={(e) => setNewWaId(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Ej: 56912345678"
              />
            </div>
            <div className="flex items-center justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => buscarEnIno(newWaId)}
                disabled={buscandoEnIno || !/^\d{6,20}$/.test(newWaId)}
              >
                {buscandoEnIno ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Buscar en INO
              </Button>
            </div>
            {candidatos && candidatos.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {candidatos.length} candidatos encontrados -- elige el correcto:
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {candidatos.map((c) => (
                    <button
                      key={c.pac_codigo}
                      type="button"
                      onClick={() => seleccionarCandidato(c)}
                      className="rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <p className="font-medium text-foreground">
                        {c.pac_nombre} {c.pac_apellido}
                        {c.pac_apellido_materno ? ` ${c.pac_apellido_materno}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">Código: {c.pac_codigo}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={form.estado}
                  onChange={(e) => setForm({ ...form, estado: e.target.value as EstadoOpcion })}
                >
                  <option value="activo">Activo (código real)</option>
                  <option value="seleccionando">Seleccionando</option>
                  <option value="esperando_rut">Esperando RUT</option>
                  <option value="sin_codigo">Sin código (vacío)</option>
                </select>
              </div>
              {form.estado === "activo" && (
                <div className="space-y-1.5">
                  <Label>Código de paciente (pac_codigo)</Label>
                  <Input
                    value={form.codigoReal}
                    onChange={(e) => setForm({ ...form, codigoReal: e.target.value })}
                    placeholder="Ej: 211662"
                  />
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input
                  value={form.pac_nombre}
                  onChange={(e) => setForm({ ...form, pac_nombre: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Apellido</Label>
                <Input
                  value={form.pac_apellido}
                  onChange={(e) => setForm({ ...form, pac_apellido: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Candidatos (pacientes_lista, JSON)</Label>
              <Textarea
                value={form.pacientes_lista}
                onChange={(e) => setForm({ ...form, pacientes_lista: e.target.value })}
                rows={3}
                className="font-mono text-xs"
                placeholder="[]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={cancelCreate} disabled={saving}>
                <X className="h-3.5 w-3.5" />
                Cancelar
              </Button>
              <Button size="sm" onClick={saveNew} disabled={saving || !/^\d{6,20}$/.test(newWaId)}>
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Crear sesión
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : sesiones.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron sesiones.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sesiones.map((row) => {
            const isEditing = editingId === row.wa_id;
            return (
              <Card key={row.wa_id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base text-foreground">
                      {row.wa_id || <span className="italic text-muted-foreground">(sin wa_id)</span>}
                    </CardTitle>
                    {!isEditing && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(row.wa_id)}
                          disabled={deletingId === row.wa_id}
                        >
                          {deletingId === row.wa_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                  <CardDescription>
                    Actualizado: {new Date(row.updated_at).toLocaleString("es-CL")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!isEditing ? (
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Estado</p>
                        <p className="text-foreground">
                          {estadoFromPacCodigo(row.pac_codigo) === "activo"
                            ? `Activo (${row.pac_codigo})`
                            : estadoFromPacCodigo(row.pac_codigo) === "seleccionando"
                              ? "Seleccionando"
                              : estadoFromPacCodigo(row.pac_codigo) === "esperando_rut"
                                ? "Esperando RUT"
                                : "Sin código"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Nombre</p>
                        <p className="text-foreground">{row.pac_nombre || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Apellido</p>
                        <p className="text-foreground">{row.pac_apellido || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Candidatos guardados</p>
                        <p className="truncate text-foreground" title={row.pacientes_lista ?? ""}>
                          {row.pacientes_lista && row.pacientes_lista !== "[]"
                            ? row.pacientes_lista
                            : "—"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    form && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => buscarEnIno(row.wa_id)}
                            disabled={buscandoEnIno}
                          >
                            {buscandoEnIno ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Wand2 className="h-3.5 w-3.5" />
                            )}
                            Buscar en INO
                          </Button>
                        </div>
                        {candidatos && candidatos.length > 0 && (
                          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                            <p className="text-xs font-medium text-muted-foreground">
                              {candidatos.length} candidatos encontrados -- elige el correcto:
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {candidatos.map((c) => (
                                <button
                                  key={c.pac_codigo}
                                  type="button"
                                  onClick={() => seleccionarCandidato(c)}
                                  className="rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
                                >
                                  <p className="font-medium text-foreground">
                                    {c.pac_nombre} {c.pac_apellido}
                                    {c.pac_apellido_materno ? ` ${c.pac_apellido_materno}` : ""}
                                  </p>
                                  <p className="text-xs text-muted-foreground">Código: {c.pac_codigo}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Estado</Label>
                            <select
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                              value={form.estado}
                              onChange={(e) =>
                                setForm({ ...form, estado: e.target.value as EstadoOpcion })
                              }
                            >
                              <option value="activo">Activo (código real)</option>
                              <option value="seleccionando">Seleccionando</option>
                              <option value="esperando_rut">Esperando RUT</option>
                              <option value="sin_codigo">Sin código (vacío)</option>
                            </select>
                          </div>
                          {form.estado === "activo" && (
                            <div className="space-y-1.5">
                              <Label>Código de paciente (pac_codigo)</Label>
                              <Input
                                value={form.codigoReal}
                                onChange={(e) => setForm({ ...form, codigoReal: e.target.value })}
                                placeholder="Ej: 211662"
                              />
                            </div>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Nombre</Label>
                            <Input
                              value={form.pac_nombre}
                              onChange={(e) => setForm({ ...form, pac_nombre: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Apellido</Label>
                            <Input
                              value={form.pac_apellido}
                              onChange={(e) => setForm({ ...form, pac_apellido: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Candidatos (pacientes_lista, JSON)</Label>
                          <Textarea
                            value={form.pacientes_lista}
                            onChange={(e) => setForm({ ...form, pacientes_lista: e.target.value })}
                            rows={3}
                            className="font-mono text-xs"
                            placeholder="[]"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
                            <X className="h-3.5 w-3.5" />
                            Cancelar
                          </Button>
                          <Button size="sm" onClick={() => saveEdit(row.wa_id)} disabled={saving}>
                            {saving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Save className="h-3.5 w-3.5" />
                            )}
                            Guardar
                          </Button>
                        </div>
                      </div>
                    )
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SesionesInoPage() {
  return (
    <AdminGate>
      <SesionesInoPageInner />
    </AdminGate>
  );
}
