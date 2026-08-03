"use client"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ShieldOff, Loader2, Trash2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DndContact {
  id: string
  name: string | null
  phone: string
  do_not_disturb_at: string | null
  do_not_disturb_source: string | null
}

export default function NoMolestarPage() {
  const [contacts, setContacts] = useState<DndContact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phone, setPhone] = useState("")
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch("/api/no-molestar")
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? "Failed to load")
      setContacts(body.contacts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function addByPhone() {
    if (!phone.trim()) {
      toast.error("Ingresa un numero de telefono")
      return
    }
    setAdding(true)
    const res = await fetch("/api/no-molestar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    })
    const body = await res.json().catch(() => ({}))
    setAdding(false)
    if (!res.ok) {
      toast.error(body?.error ?? "No se pudo agregar")
      return
    }
    setPhone("")
    toast.success("Contacto agregado a No Molestar")
    load()
  }

  async function remove(id: string) {
    setRemovingId(id)
    const res = await fetch("/api/no-molestar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact_id: id, opt_in: true }),
    })
    const body = await res.json().catch(() => ({}))
    setRemovingId(null)
    if (!res.ok) {
      toast.error(body?.error ?? "No se pudo quitar")
      return
    }
    toast.success("Contacto removido de No Molestar")
    setContacts((prev) => (prev ?? []).filter((c) => c.id !== id))
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    )
  }

  if (contacts === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">No Molestar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Contactos que no deben recibir mensajes de campañas (Ley No Molestar / SERNAC).
          Se agregan automaticamente cuando escriben la frase de opt-out, o manualmente aqui.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-sm font-semibold text-foreground">Agregar manualmente</p>
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-64 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            placeholder="+56 9 1234 5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button onClick={addByPhone} disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Agregar
          </Button>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <ShieldOff className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            Ningun contacto en No Molestar todavia
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2">Contacto</th>
                <th className="px-4 py-2">Telefono</th>
                <th className="px-4 py-2">Origen</th>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-foreground">{c.name ?? "-"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {c.do_not_disturb_source === "keyword_reply" ? "Mensaje del contacto" : "Manual"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {c.do_not_disturb_at ? new Date(c.do_not_disturb_at).toLocaleString("es-CL") : "-"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => remove(c.id)}
                      disabled={removingId === c.id}
                    >
                      {removingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Quitar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
