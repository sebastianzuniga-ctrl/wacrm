"use client";

import { jsPDF } from "jspdf";
import { FAQ_CATEGORIES } from "./faq-content";

/**
 * Genera y descarga un PDF con el contenido completo del FAQ de ayuda.
 * Misma fuente de datos que la página /ayuda (faq-content.ts) para que
 * ambos nunca queden desincronizados. Client-side (jsPDF) - no requiere
 * ningún endpoint de servidor ni renderizado HTML->PDF pesado.
 */
export function downloadHelpPdf(): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 56;
  const marginTop = 64;
  const marginBottom = 56;
  const contentWidth = pageWidth - marginX * 2;

  let y = marginTop;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
    }
  };

  // Portada / encabezado
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("wspcrm INO — Ayuda y preguntas frecuentes", marginX, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  const today = new Date().toLocaleDateString("es-CL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.text(`Generado el ${today}`, marginX, y);
  doc.setTextColor(0);
  y += 30;

  for (const category of FAQ_CATEGORIES) {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(30, 30, 30);
    doc.text(category.title, marginX, y);
    y += 10;
    doc.setDrawColor(200);
    doc.line(marginX, y, marginX + contentWidth, y);
    y += 20;

    for (const item of category.items) {
      const questionLines = doc.splitTextToSize(
        item.question,
        contentWidth
      ) as string[];
      const answerLines = doc.splitTextToSize(
        item.answer,
        contentWidth
      ) as string[];

      const questionHeight = questionLines.length * 15;
      const answerHeight = answerLines.length * 13;
      ensureSpace(questionHeight + answerHeight + 20);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(0);
      doc.text(questionLines, marginX, y);
      y += questionHeight + 4;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text(answerLines, marginX, y);
      y += answerHeight + 16;
    }

    y += 10;
  }

  // Numeración de páginas
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth - marginX,
      pageHeight - 30,
      { align: "right" }
    );
  }

  doc.save("wspcrm-ino-ayuda-faq.pdf");
}
