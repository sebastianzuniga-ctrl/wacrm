'use client';

import type { ReactNode } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole, type AccountRole } from '@/lib/auth/roles';

/**
 * Server-side-equivalent gate for client-rendered dashboard pages.
 * Sidebar hiding (minRole en sidebar.tsx) is cosmetic only — un usuario
 * con el rol insuficiente que navega directo por URL igual carga la
 * página completa detrás del sidebar. Este wrapper corta eso: mientras
 * el perfil no resuelve muestra un spinner (nunca el contenido real),
 * y si el rol no alcanza, muestra "Acceso restringido" en vez de montar
 * el children — mismo patrón ya usado en settings/page.tsx e
 * historial/page.tsx.
 */
export function AdminGate({
  children,
  minRole = 'admin',
}: {
  children: ReactNode;
  minRole?: AccountRole;
}) {
  const { accountRole, profileLoading, allowedPages } = useAuth();
  const pathname = usePathname();
  // Mismo criterio que el sidebar (fix 2026-09-03): si el perfil
  // personalizado incluye explicitamente esta pagina, eso gana por
  // sobre minRole -- es un permiso otorgado a proposito. Sin perfil
  // asignado, se usa minRole como antes. Sin este ajuste, un admin
  // podia marcar "Contactos" como permitido para un perfil de agente
  // y el link aparecia en el sidebar, pero este gate seguia
  // bloqueando la pagina igual con "Acceso restringido".
  const allowed = allowedPages
    ? allowedPages.includes(pathname)
    : !profileLoading && !!accountRole && hasMinRole(accountRole, minRole);

  if (profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Acceso restringido</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Esta sección es solo para administradores.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
