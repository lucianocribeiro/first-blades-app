/**
 * FB-F5-06 — lib/markdown.ts: renderMarkdownToSafeHtml
 *
 * Test obligatorio (regla técnica de FB-F5-06): contenido con HTML o script
 * embebido NUNCA debe llegar sin sanitizar al HTML que termina en
 * dangerouslySetInnerHTML — sin excepción, ni siquiera para contenido
 * escrito por un admin.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdownToSafeHtml } from '@/lib/markdown';

describe('renderMarkdownToSafeHtml: sanitización (obligatorio)', () => {
  it('elimina un <script> embebido en el Markdown de origen', () => {
    const html = renderMarkdownToSafeHtml('Texto normal.\n\n<script>alert("xss")</script>\n\nMás texto.');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(');
  });

  it('elimina un atributo onerror/onclick embebido', () => {
    const html = renderMarkdownToSafeHtml('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('elimina un iframe embebido', () => {
    const html = renderMarkdownToSafeHtml('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('elimina un link con esquema javascript:', () => {
    const html = renderMarkdownToSafeHtml('[click acá](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('elimina un <style> embebido (no debería afectar el resto de la página)', () => {
    const html = renderMarkdownToSafeHtml('<style>body{display:none}</style>Texto.');
    expect(html).not.toContain('<style');
  });

  it('un <a> legítimo conserva href pero fuerza target=_blank y rel=noopener noreferrer', () => {
    const html = renderMarkdownToSafeHtml('[Manual externo](https://example.com/manual.pdf)');
    expect(html).toContain('href="https://example.com/manual.pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('renderMarkdownToSafeHtml: formato legítimo (positivo)', () => {
  it('negrita, listas y títulos se convierten a las etiquetas HTML esperadas', () => {
    const html = renderMarkdownToSafeHtml('## Título\n\n**negrita**\n\n- ítem 1\n- ítem 2');
    expect(html).toContain('<h2>Título</h2>');
    expect(html).toContain('<strong>negrita</strong>');
    expect(html).toContain('<li>ítem 1</li>');
    expect(html).toContain('<li>ítem 2</li>');
  });

  it('contenido multilínea con párrafos separados se preserva', () => {
    const html = renderMarkdownToSafeHtml('Paso 1: hacer esto.\n\nPaso 2: hacer aquello.');
    expect(html).toContain('Paso 1: hacer esto.');
    expect(html).toContain('Paso 2: hacer aquello.');
  });

  it('string vacío no rompe (devuelve HTML vacío o mínimo, no tira)', () => {
    expect(() => renderMarkdownToSafeHtml('')).not.toThrow();
  });
});
