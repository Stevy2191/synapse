// A code block inside a note: the code, with a bar on top to pick its language and copy it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { textblockTypeInputRule } from '@tiptap/core';
import { Check, ChevronDown, Copy, Search } from 'lucide-react';
import { editorLowlight, filterLanguages, findLanguage, detectLanguage } from './codeLanguages';

function LanguagePicker({ value, detected, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const boxRef = useRef(null);
  const items = useMemo(() => {
    const langs = filterLanguages(query);
    return query.trim() ? langs : [{ id: null, label: 'Auto-detect' }, ...langs];
  }, [query]);

  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  useEffect(() => {
    const away = e => { if (!boxRef.current?.contains(e.target)) onClose(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);

  const keyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[index]) onPick(items[index].id); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="code-lang-picker" ref={boxRef}>
      <div className="code-lang-search">
        <Search size={13} />
        <input ref={inputRef} value={query} placeholder="Search languages…" onChange={e => setQuery(e.target.value)} onKeyDown={keyDown} />
      </div>
      <div className="code-lang-list" ref={listRef} role="listbox">
        {items.map((l, i) => {
          const current = l.id === null ? !value : findLanguage(value)?.id === l.id;
          return (
            <button key={l.id ?? 'auto'} type="button" role="option" aria-selected={i === index}
              className={i === index ? 'active' : ''} onMouseEnter={() => setIndex(i)}
              onMouseDown={e => e.preventDefault()} onClick={() => onPick(l.id)}>
              <span>{l.label}{l.id === null && detected ? <em> · {findLanguage(detected)?.label || detected}</em> : null}</span>
              {current && <Check size={13} />}
            </button>
          );
        })}
        {items.length === 0 && <div className="code-lang-empty">No match. Plain text is used.</div>}
      </div>
    </div>
  );
}

function CodeBlockView({ node, updateAttributes, editor }) {
  const language = node.attrs.language || null;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = node.textContent;
  const known = findLanguage(language);
  // Only guess when no language is set; cheap enough to redo as the text changes.
  const detected = useMemo(() => (language ? null : detectLanguage(text)), [language, text]);

  const label = known ? known.label
    : language ? language
    : detected ? `Auto · ${findLanguage(detected)?.label || detected}` : 'Auto-detect';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const pick = id => {
    updateAttributes({ language: id });
    setOpen(false);
    editor.commands.focus();
  };

  return (
    <NodeViewWrapper className="code-block">
      <div className="code-block-bar" contentEditable={false}>
        {editor.isEditable ? (
          <button type="button" className="code-lang-btn" onClick={() => setOpen(o => !o)} title="Choose the language">
            {label} <ChevronDown size={12} />
          </button>
        ) : <span className="code-lang-btn static">{label}</span>}
        <button type="button" className="code-copy-btn" onClick={copy} title="Copy code">
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
        {open && <LanguagePicker value={language} detected={detected} onPick={pick} onClose={() => setOpen(false)} />}
      </div>
      <pre spellCheck={false}>
        <NodeViewContent as="code" className={`hljs${language ? ` language-${language}` : ''}`} />
      </pre>
    </NodeViewWrapper>
  );
}

/** Code blocks with syntax colors for ~95 languages, a language picker and a Copy button. */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
  // ```lang + space starts a block. The built-in rule only takes letters; this also allows
  // names like ps1, c++, c#, objective-c.
  addInputRules() {
    return ['`', '~'].map(ch => textblockTypeInputRule({
      find: new RegExp(`^${ch}{3}([a-z0-9][a-z0-9+#._-]*)?[\\s\\n]$`, 'i'),
      type: this.type,
      getAttributes: match => ({ language: match[1] ? match[1].toLowerCase() : null }),
    }));
  },
}).configure({ lowlight: editorLowlight, defaultLanguage: null });
