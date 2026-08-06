// Markdown → HTML sanitizado, para el contenido de texto de Procedimientos
// (FB-F5-06). El contenido se guarda como Markdown (no HTML): no queda
// atado a este editor y no arrastra HTML crudo escrito a mano.
//
// La sanitización corre SIEMPRE en el render, nunca al guardar — el
// Markdown fuente queda intacto para poder reeditarlo. Sin excepción,
// incluido contenido escrito por un admin: `marked` no es un sanitizador,
// solo convierte sintaxis a HTML, y ese HTML puede incluir <script>/onerror
// si el Markdown de origen los tiene embebidos (Markdown permite HTML
// inline). `sanitize-html` corre 100% en Node sin necesitar un DOM (a
// diferencia de DOMPurify, que necesita jsdom del lado del servidor) — ver
// la justificación completa de la elección de librería en el reporte de
// cierre de FB-F5-06.
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: true });

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  // target/rel: los agrega transformTags de abajo (no el Markdown de
  // origen) — tienen que estar permitidos acá o sanitize-html los filtra
  // igual después de agregarlos.
  a: ['href', 'title', 'target', 'rel'],
};

export function renderMarkdownToSafeHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown ?? '', { async: false });

  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    // Links externos: nunca dejar que el HTML de origen imponga su propio
    // target/rel (window.opener / referrer leak) — se fuerza acá.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  });
}
