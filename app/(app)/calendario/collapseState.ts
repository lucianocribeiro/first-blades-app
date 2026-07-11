// FB-F3-11: preferencia de colapsado/expandido de las secciones de
// /calendario, persistida por cookie (no localStorage, no base — es
// cosmético). Se lee en el server component en el render inicial (sin
// parpadeo) y se escribe desde el cliente al togglear una sección.
// FB-F3-21: agrega 'saldo' (panel de saldo de días de trámite).
export type SeccionId = 'alertas' | 'resumen' | 'saldo' | 'calendario';

// true = expandida.
export type CollapseState = Record<SeccionId, boolean>;

export const COLLAPSE_COOKIE_NAME = 'fb_calendario_secciones';
const COLLAPSE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 año

// Default SOLO cuando todavía no hay cookie guardada (PRD: calendario
// arranca expandido; el resto, colapsado).
export const DEFAULT_COLLAPSE_STATE: CollapseState = {
  alertas: false,
  resumen: false,
  saldo: false,
  calendario: true,
};

function isCollapseState(value: unknown): value is CollapseState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.alertas === 'boolean' &&
    typeof v.resumen === 'boolean' &&
    typeof v.saldo === 'boolean' &&
    typeof v.calendario === 'boolean'
  );
}

// Cookie ausente o malformada → default; nunca lanza (input externo, no
// se confía en su forma).
export function parseCollapseState(raw: string | undefined): CollapseState {
  if (!raw) return DEFAULT_COLLAPSE_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCollapseState(parsed) ? parsed : DEFAULT_COLLAPSE_STATE;
  } catch {
    return DEFAULT_COLLAPSE_STATE;
  }
}

// Solo se invoca desde un event handler en cliente (CalendarioSections);
// el server component solo importa parseCollapseState de este módulo.
export function setCollapseCookie(state: CollapseState): void {
  document.cookie = `${COLLAPSE_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${COLLAPSE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
