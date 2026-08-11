"use client";

import { useState } from "react";
import { HelpCircle, Download, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { FAQ_CATEGORIES } from "@/lib/help/faq-content";
import { downloadHelpPdf } from "@/lib/help/help-pdf";

export default function AyudaPage() {
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);

  const query = search.trim().toLowerCase();
  const filteredCategories = query
    ? FAQ_CATEGORIES.map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            item.question.toLowerCase().includes(query) ||
            item.answer.toLowerCase().includes(query)
        ),
      })).filter((cat) => cat.items.length > 0)
    : FAQ_CATEGORIES;

  async function handleDownload() {
    setDownloading(true);
    try {
      downloadHelpPdf();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <HelpCircle className="size-6 text-primary" />
            Ayuda y preguntas frecuentes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Guía de uso del sistema para ejecutivos y administradores.
          </p>
        </div>
        <Button
          onClick={handleDownload}
          disabled={downloading}
          variant="outline"
          className="gap-2 shrink-0"
        >
          <Download className="size-4" />
          Descargar PDF
        </Button>
      </div>

      <div className="relative mt-6">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar en la ayuda..."
          className="pl-9"
        />
      </div>

      <div className="mt-6 space-y-6">
        {filteredCategories.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No se encontraron resultados para &quot;{search}&quot;.
          </p>
        )}

        {filteredCategories.map((category) => (
          <div key={category.id}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {category.title}
            </h2>
            <Accordion className="rounded-lg border border-border">
              {category.items.map((item, idx) => (
                <AccordionItem key={idx} className="border-border">
                  <AccordionTrigger className="text-foreground hover:no-underline">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        ))}
      </div>
    </div>
  );
}
