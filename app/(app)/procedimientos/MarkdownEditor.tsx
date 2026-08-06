'use client';

import { useRef } from 'react';
import { Bold, List, Heading } from 'lucide-react';
import { Textarea } from '@/components/ui/Textarea';
import { copy } from '@/lib/copy';

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
};

// Editor liviano: textarea + toolbar que inserta sintaxis Markdown en la
// selección actual (sin dependencia de un editor rich-text — ver
// justificación en el reporte de cierre de FB-F5-06). El renderizado
// sanitizado vive en lib/markdown.ts y corre solo al VER un procedimiento,
// nunca acá.
export function MarkdownEditor({ value, onChange, label, required }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function applyWrap(prefix: string, suffix: string, placeholder: string) {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const next = value.slice(0, start) + prefix + selected + suffix + value.slice(end);

    onChange(next);

    requestAnimationFrame(() => {
      el.focus();
      const cursorStart = start + prefix.length;
      el.setSelectionRange(cursorStart, cursorStart + selected.length);
    });
  }

  function applyLinePrefix(linePrefix: string, placeholder: string) {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const hasContent = value.slice(lineStart, el.selectionEnd).trim().length > 0;
    const insertion = hasContent ? linePrefix : `${linePrefix}${placeholder}`;
    const next = value.slice(0, lineStart) + insertion + value.slice(lineStart);

    onChange(next);

    requestAnimationFrame(() => {
      el.focus();
      const cursorPos = lineStart + insertion.length;
      el.setSelectionRange(cursorPos, cursorPos);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-secondary">
          {label}
          {required && <span className="text-error ml-1">*</span>}
        </label>
      )}
      <div className="flex items-center gap-1 border border-color-border border-b-0 rounded-t-lg bg-surface px-2 py-1.5">
        <button
          type="button"
          onClick={() => applyWrap('**', '**', 'texto en negrita')}
          className="p-1.5 rounded text-neutral hover:text-secondary hover:bg-white transition-colors"
          aria-label={copy.procedimientos.markdownToolbar.negrita}
          title={copy.procedimientos.markdownToolbar.negrita}
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          onClick={() => applyLinePrefix('- ', 'ítem de la lista')}
          className="p-1.5 rounded text-neutral hover:text-secondary hover:bg-white transition-colors"
          aria-label={copy.procedimientos.markdownToolbar.lista}
          title={copy.procedimientos.markdownToolbar.lista}
        >
          <List size={15} />
        </button>
        <button
          type="button"
          onClick={() => applyLinePrefix('## ', 'Título')}
          className="p-1.5 rounded text-neutral hover:text-secondary hover:bg-white transition-colors"
          aria-label={copy.procedimientos.markdownToolbar.titulo}
          title={copy.procedimientos.markdownToolbar.titulo}
        >
          <Heading size={15} />
        </button>
      </div>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="rounded-t-none min-h-[220px] font-mono text-[13px]"
      />
    </div>
  );
}
