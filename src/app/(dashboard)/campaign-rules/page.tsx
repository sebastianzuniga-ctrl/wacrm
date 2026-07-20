"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Route, Loader2, Save } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import type { MessageTemplate } from "@/types"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

type ActionType = "none" | "send_text" | "webhook" | "ai_agent"

interface RuleRow {
  id?: string
  template_name: string
  reply_value: string
  action_type: ActionType
  action_text: string
  webhook_url: string
  is_active: boolean
  saving: boolean
}

function ruleKey(templateName: string, replyValue: string) {
  return `${templateName}\u0000${replyValue}`
}

export default function CampaignRulesPage() {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null)
  const [rules, setRules] = useState<Map<string, RuleRow>>(new Map())
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const supabase = createClient()
      const [{ data: tpls, error: tplErr }, rulesRes] = await Promise.all([
        supabase
          .from("message_templates")
          .select("*")
          .eq("status", "APPROVED")
          .order("created_at", { ascending: false }),
        fetch("/api/broadcast-reply-rules"),
      ])
      if (tplErr) throw tplErr
      const rulesBody = await rulesRes.json().catch(() => ({}))
      if (!rulesRes.ok) throw new Error(rulesBody?.error ?? "Failed to load rules")

      const list = (tpls ?? []) as MessageTemplate[]
      setTemplates(list)

      const map = new Map<string, RuleRow>()
      // Seed a draft row for every quick-reply button on every approved
      // template, so the UI always shows every possible reply even
      // before a rule has ever been saved for it.
      for (const tpl of list) {
        for (const btn of tpl.buttons ?? []) {
          if (btn.type !== "QUICK_REPLY") continue
          const key = ruleKey(tpl.name, btn.text)
          map.set(key, {
            template_name: tpl.name,
            reply_value: btn.text,
            action_type: "none",
            action_text: "",
            webhook_url: "",
            is_active: true,
            saving: false,
          })
        }
      }
      // Overlay saved rules on top of the drafts.
      for (const r of rulesBody.rules ?? []) {
        const key = ruleKey(r.template_name, r.reply_value)
        map.set(key, {
          id: r.id,
          template_name: r.template_name,
          reply_value: r.reply_value,
          action_type: r.action_type,
          action_text: r.action_text ?? "",
          webhook_url: r.webhook_url ?? "",
          is_active: r.is_active,
          saving: false,
        })
      }
      setRules(map)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    }
  }

  useEffect(() => {
    load()
  }, [])

  function updateRow(key: string, patch: Partial<RuleRow>) {
    setRules((prev) => {
      const next = new Map(prev)
      const row = next.get(key)
      if (row) next.set(key, { ...row, ...patch })
      return next
    })
  }

  async function saveRow(key: string) {
    const row = rules.get(key)
    if (!row) return
    if (row.action_type === "send_text" && !row.action_text.trim()) {
      toast.error("Enter the reply text first")
      return
    }
    if (row.action_type === "webhook" && !row.webhook_url.trim()) {
      toast.error("Enter the webhook URL first")
      return
    }
    updateRow(key, { saving: true })
    const res = await fetch("/api/broadcast-reply-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        template_name: row.template_name,
        reply_value: row.reply_value,
        action_type: row.action_type,
        action_text:
          row.action_type === "send_text" || row.action_type === "ai_agent"
            ? row.action_text
            : null,
        webhook_url: row.action_type === "webhook" ? row.webhook_url : null,
        is_active: row.is_active,
      }),
    })
    const body = await res.json().catch(() => ({}))
    updateRow(key, { saving: false })
    if (!res.ok) {
      toast.error(body?.error ?? "Failed to save rule")
      return
    }
    updateRow(key, { id: body.rule?.id })
    toast.success("Rule saved")
  }

  const templatesWithButtons = useMemo(
    () =>
      (templates ?? []).filter((tpl) =>
        (tpl.buttons ?? []).some((b) => b.type === "QUICK_REPLY")
      ),
    [templates]
  )

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

  if (templates === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Campaign Rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Decide what happens when a contact taps a quick-reply button on a
          campaign message.
        </p>
      </div>

      {templatesWithButtons.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Route className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            No approved templates with quick-reply buttons yet
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {templatesWithButtons.map((tpl) => (
            <div key={tpl.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-foreground">{tpl.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{tpl.body_text}</p>
              </div>
              <div className="space-y-3">
                {(tpl.buttons ?? [])
                  .filter((b) => b.type === "QUICK_REPLY")
                  .map((btn) => {
                    const key = ruleKey(tpl.name, btn.text)
                    const row = rules.get(key)
                    if (!row) return null
                    return (
                      <div
                        key={key}
                        className="rounded-lg border border-border bg-background/40 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {btn.text}
                          </span>

                          <select
                            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                            value={row.action_type}
                            onChange={(e) =>
                              updateRow(key, {
                                action_type: e.target.value as ActionType,
                              })
                            }
                          >
                            <option value="none">No action</option>
                            <option value="send_text">Reply with text</option>
                            <option value="webhook">Call a webhook (n8n)</option>
                            <option value="ai_agent">Notify AI agent (n8n)</option>
                          </select>

                          <Switch
                            checked={row.is_active}
                            onCheckedChange={(v) => updateRow(key, { is_active: !!v })}
                            aria-label={row.is_active ? "Active" : "Inactive"}
                          />

                          <Button
                            size="sm"
                            onClick={() => saveRow(key)}
                            disabled={row.saving}
                            className="ml-auto bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            {row.saving ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                            Save
                          </Button>
                        </div>

                        {row.action_type === "send_text" && (
                          <textarea
                            className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                            rows={2}
                            placeholder="Auto-reply text"
                            value={row.action_text}
                            onChange={(e) => updateRow(key, { action_text: e.target.value })}
                          />
                        )}

                        {row.action_type === "webhook" && (
                          <input
                            className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                            placeholder="https://n8n.your-domain.cl/webhook/..."
                            value={row.webhook_url}
                            onChange={(e) => updateRow(key, { webhook_url: e.target.value })}
                          />
                        )}

                        {row.action_type === "ai_agent" && (
                          <textarea
                            className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                            rows={2}
                            placeholder='Event message sent to the configured AI agent (e.g. "Patient replied SI, book their first appointment"). Leave empty for a generic default.'
                            value={row.action_text}
                            onChange={(e) => updateRow(key, { action_text: e.target.value })}
                          />
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
