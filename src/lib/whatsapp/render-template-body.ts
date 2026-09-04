/**
 * Sustituye {{1}}, {{2}}, ... en el body de una plantilla por los
 * valores capturados en el formulario de envío 1:1 (inbox y ficha de
 * Contacto comparten esta función -- antes cada uno tenía su propia
 * copia y contact-detail-view.tsx directamente no la tenía, dejando
 * content_text vacío en la base para todo envío de plantilla hecho
 * desde la ficha de Contacto, con o sin variables).
 *
 * Nota: esto es DISTINTO de renderTemplatePreview en broadcast-core.ts
 * (que además maneja un fallback "[Template: nombre]" para el caso de
 * no encontrar la fila local de la plantilla en un envío de campaña) --
 * no se unificaron porque los casos de uso y fallback son distintos.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}
