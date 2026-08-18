// ============================================================
// Lista de ítems de menú controlables por perfil personalizado
// (Configuración > Perfiles, migración 057).
//
// Espejo de navItems en src/components/layout/sidebar.tsx --
// mantener sincronizado si se agrega/quita una página del menú.
// Se extrajo a un archivo compartido en vez de importar desde el
// sidebar directamente porque ese componente es "use client" con
// dependencias de iconos que no hacen falta en el panel de admin.
// ============================================================
export interface MenuItemDef {
  href: string;
  labelKey: string;
}

export const CUSTOM_PROFILE_MENU_ITEMS: MenuItemDef[] = [
  { href: '/dashboard', labelKey: 'dashboard' },
  { href: '/inbox', labelKey: 'inbox' },
  { href: '/notifications', labelKey: 'notifications' },
  { href: '/ayuda', labelKey: 'help' },
  { href: '/contacts', labelKey: 'contacts' },
  { href: '/pipelines', labelKey: 'pipelines' },
  { href: '/broadcasts', labelKey: 'broadcasts' },
  { href: '/campaign-rules', labelKey: 'campaignRules' },
  { href: '/no-molestar', labelKey: 'noMolestar' },
  { href: '/automations', labelKey: 'automations' },
  { href: '/flows', labelKey: 'flows' },
  { href: '/agents', labelKey: 'aiAgents' },
  { href: '/historial', labelKey: 'historial' },
  { href: '/sesiones-ino', labelKey: 'sesionesIno' },
  { href: '/settings', labelKey: 'settings' },
];
