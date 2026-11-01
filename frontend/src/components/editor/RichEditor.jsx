import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import UnderlineExt from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { Link as LinkExt } from '@tiptap/extension-link';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import {
  Bold, Italic, Underline, Strikethrough, Code, Link as LinkIcon, Quote, Highlighter, Heading1, Heading2, Heading3,
  Type, ListChecks, List, ListOrdered, Code2, Table as TableIcon, Minus, Image as ImageIcon, FileText, Plus,
  ArrowDownToLine, ArrowRightToLine, Trash2, GitFork, Pencil, Workflow, PenTool,
} from 'lucide-react';
import { SlashCommand, WikiLinkSuggest, WikiLinkDecorations } from './extensions';
import { DiagramNode } from '../diagrams/DiagramNode';

const lowlight = createLowlight();
lowlight.register({ javascript, python, bash });

const SLASH_ICONS = {
  text: Type, h1: Heading1, h2: Heading2, h3: Heading3, todo: ListChecks, ul: List, ol: ListOrdered,
  link: FileText, quote: Quote, code: Code2, table: TableIcon, divider: Minus, image: ImageIcon,
  drawio: Workflow, excalidraw: PenTool,
};
const NOTE_ICONS = { note: FileText, diagram: GitFork, draw: Pencil };
const COLORS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#7c7bff', '#a855f7', '#ec4899'];

/**
 * The default note editor, in the style of Outline: what you see is the finished note.
 *  - Markdown shortcuts while typing: "# " heading, "**bold**", "- " list, "[] " checklist, "> " quote, "```" code
 *  - "/" opens a menu of blocks; "[[" links to another note
 *  - Selecting text shows a formatting toolbar; inside a table, table controls appear
 * Content is HTML; the page also keeps a Markdown copy for search, links and the Markdown view.
 */
export default function RichEditor({ content, onChange, editorRef: editorRefProp }) {
  const lastHtmlRef = useRef(content);
  const isFirstLoad = useRef(true);
  const [menu, setMenu] = useState(null); // { kind, items, index, rect, command }
  const menuRef = useRef(null);
  menuRef.current = menu;

  // Bridge from the suggestion plugins to React state.
  const ui = useRef({});
  ui.current = {
    open: (kind, props) => setMenu(prev => ({
      kind, items: props.items, command: props.command, rect: props.clientRect?.(),
      index: prev && prev.kind === kind ? Math.min(prev.index, Math.max(props.items.length - 1, 0)) : 0,
    })),
    close: (kind) => setMenu(prev => (prev?.kind === kind ? null : prev)),
    keyDown: (event) => {
      const m = menuRef.current;
      if (!m || m.items.length === 0) return false;
      if (event.key === 'ArrowDown') { setMenu({ ...m, index: (m.index + 1) % m.items.length }); return true; }
      if (event.key === 'ArrowUp') { setMenu({ ...m, index: (m.index - 1 + m.items.length) % m.items.length }); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { m.command(m.items[m.index]); return true; }
      if (event.key === 'Escape') { setMenu(null); return true; }
      return false;
    },
  };
  const getUi = useCallback(() => ui.current, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false, underline: false }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Type / for blocks, [[ to link a note…'),
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Image.configure({ inline: false }),
      UnderlineExt,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Subscript,
      Superscript,
      LinkExt.configure({ openOnClick: false, autolink: true }),
      SlashCommand.configure({ getUi }),
      WikiLinkSuggest.configure({ getUi }),
      WikiLinkDecorations,
      DiagramNode,
    ],
    content: content || '<p></p>',
    // The styles below are scoped to this class.
    editorProps: { attributes: { class: 'rich-editor-content' } },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastHtmlRef.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (editorRefProp) editorRefProp.current = editor;
  }, [editor, editorRefProp]);

  // Only reload when the content changes from outside (another note, a sync, a mode switch)
  useEffect(() => {
    if (!editor) return;
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    if (content !== lastHtmlRef.current) {
      lastHtmlRef.current = content;
      editor.commands.setContent(content || '<p></p>', { emitUpdate: false });
    }
  }, [content]);

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes('link').href || '';
    const href = window.prompt('Link address (leave empty to remove):', prev);
    if (href === null) return;
    if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(href) ? href : `https://${href}` }).run();
  };

  const B = ({ on, title, onClick, children }) => (
    <button className={`btn-ghost${on ? ' on' : ''}`} title={title} onMouseDown={e => { e.preventDefault(); onClick(); }}
      style={{ height: 30, minWidth: 30, padding: '0 6px' }}>{children}</button>
  );
  const Sep = () => <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px' }} />;

  return (
    <div style={{ position: 'relative' }}>
      <style>{`
          .rich-editor-content {
            outline: none;
            padding: 0 0 40vh;
            font-family: var(--font-sans);
            font-size: 16px;
            line-height: 1.75;
            color: var(--text-primary);
            cursor: text;
          }
          .rich-editor-content h1 { font-family: var(--font-display); font-size: 1.75em; font-weight: 700; margin: 1em 0 0.4em; letter-spacing: -0.02em; }
          .rich-editor-content h2 { font-family: var(--font-display); font-size: 1.35em; font-weight: 600; margin: 0.9em 0 0.3em; letter-spacing: -0.01em; }
          .rich-editor-content h3 { font-size: 1.2em; font-weight: 600; margin: 0.8em 0 0.3em; }
          .rich-editor-content h4 { font-size: 1.05em; font-weight: 600; margin: 0.7em 0 0.2em; }
          .rich-editor-content p { margin: 0.3em 0; min-height: 1.6em; }
          .rich-editor-content p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            color: var(--text-muted);
            float: left;
            height: 0;
            pointer-events: none;
          }
          /* Regular lists */
          .rich-editor-content ul:not([data-type="taskList"]),
          .rich-editor-content ol {
            padding-left: 1.8em;
            margin: 0.5em 0;
          }
          .rich-editor-content li { margin: 0.3em 0; }
          .rich-editor-content li > p { margin: 0; }
          /* Task list */
          .rich-editor-content ul[data-type="taskList"] {
            list-style: none;
            padding-left: 0;
            margin: 0.5em 0;
          }
          .rich-editor-content ul[data-type="taskList"] > li {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            gap: 10px;
            margin: 0.4em 0;
            padding: 2px 0;
          }
          .rich-editor-content ul[data-type="taskList"] > li > label {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            padding-top: 3px;
            cursor: pointer;
          }
          .rich-editor-content ul[data-type="taskList"] > li > label > input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: var(--accent);
            cursor: pointer;
            margin: 0;
            flex-shrink: 0;
          }
          .rich-editor-content ul[data-type="taskList"] > li > div {
            flex: 1;
            min-width: 0;
            cursor: text;
          }
          .rich-editor-content ul[data-type="taskList"] > li > div > p {
            margin: 0;
            min-height: 1.6em;
          }
          .rich-editor-content ul[data-type="taskList"] > li[data-checked="true"] > div > p {
            text-decoration: line-through;
            color: var(--text-muted);
          }
          /* Blockquote */
          .rich-editor-content blockquote {
            border-left: 3px solid var(--accent);
            padding-left: 1em;
            color: var(--text-secondary);
            margin: 0.8em 0;
            font-style: italic;
          }
          /* Code */
          .rich-editor-content code {
            background: var(--bg-elevated);
            color: var(--accent-hover);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: var(--font-mono);
            font-size: 0.88em;
          }
          .rich-editor-content pre {
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
            margin: 1em 0;
          }
          .rich-editor-content pre code {
            background: none;
            padding: 0;
            color: var(--text-primary);
          }
          .rich-editor-content hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
          .rich-editor-content img { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }
          .rich-editor-content a { color: var(--accent); text-decoration: none; }
          .rich-editor-content a:hover { text-decoration: underline; }
          .rich-editor-content table { border-collapse: collapse; width: 100%; margin: 1em 0; }
          .rich-editor-content td, .rich-editor-content th { border: 1px solid var(--border); padding: 8px 12px; min-width: 60px; }
          .rich-editor-content th { background: var(--bg-elevated); font-weight: 600; }
          .rich-editor-content .selectedCell { background: var(--accent-subtle); }
          .ProseMirror-selectednode { outline: 2px solid var(--accent); border-radius: 4px; }
          .hljs-keyword { color: #ff79c6; } .hljs-string { color: #f1fa8c; }
          .hljs-comment { color: #6272a4; } .hljs-number { color: #bd93f9; }
          .hljs-built_in { color: #8be9fd; } .hljs-function { color: #50fa7b; }
        `}</style>

      {/* Formatting toolbar: appears over selected text */}
      <BubbleMenu editor={editor} pluginKey="formatMenu"
        shouldShow={({ editor: ed, state }) => !state.selection.empty && !ed.isActive('codeBlock') && !ed.isActive('image') && !ed.isActive('diagram')}
        options={{ placement: 'top', offset: 8 }}>
        <div className="floating-menu">
          <B on={editor.isActive('bold')} title="Bold (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></B>
          <B on={editor.isActive('italic')} title="Italic (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></B>
          <B on={editor.isActive('underline')} title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15} /></B>
          <B on={editor.isActive('strike')} title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></B>
          <B on={editor.isActive('code')} title="Inline code" onClick={() => editor.chain().focus().toggleCode().run()}><Code size={15} /></B>
          <Sep />
          <B on={editor.isActive('heading', { level: 1 })} title="Heading 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></B>
          <B on={editor.isActive('heading', { level: 2 })} title="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></B>
          <B on={editor.isActive('blockquote')} title="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></B>
          <B on={editor.isActive('taskList')} title="Checklist" onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={15} /></B>
          <Sep />
          <B on={editor.isActive('link')} title="Link" onClick={setLink}><LinkIcon size={15} /></B>
          <B on={editor.isActive('highlight')} title="Highlight" onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={15} /></B>
          <span className="color-row">
            {COLORS.map(c => (
              <button key={c || 'none'} title={c ? 'Text colour' : 'Default colour'}
                onMouseDown={e => { e.preventDefault(); c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run(); }}
                style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--border)', cursor: 'pointer', padding: 0,
                  background: c || 'var(--text-primary)', outline: editor.isActive('textStyle', { color: c }) ? '2px solid var(--accent)' : 'none' }} />
            ))}
          </span>
        </div>
      </BubbleMenu>

      {/* Table controls: appear while the cursor is in a table */}
      <BubbleMenu editor={editor} pluginKey="tableMenu"
        shouldShow={({ editor: ed, state }) => state.selection.empty && ed.isActive('table')}
        options={{ placement: 'top', offset: 8 }}>
        <div className="floating-menu">
          <B title="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}><ArrowDownToLine size={15} /> Row</B>
          <B title="Add column to the right" onClick={() => editor.chain().focus().addColumnAfter().run()}><ArrowRightToLine size={15} /> Column</B>
          <Sep />
          <B title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}><Trash2 size={14} /> Row</B>
          <B title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}><Trash2 size={14} /> Column</B>
          <B title="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 size={14} /> Table</B>
        </div>
      </BubbleMenu>

      <EditorContent editor={editor} />

      {/* "/" and "[[" menus */}
      {menu && menu.rect && menu.items.length > 0 && (
        <div className="suggest-menu fade-in" style={menuPosition(menu.rect)}>
          <div className="section-label" style={{ padding: '6px 10px 4px' }}>{menu.kind === 'slash' ? 'Insert' : 'Link to note'}</div>
          {menu.items.map((item, i) => {
            const Icon = menu.kind === 'slash' ? SLASH_ICONS[item.id] : item.kind === 'create' ? Plus : (NOTE_ICONS[item.noteType] || FileText);
            return (
              <button key={item.id} className={`suggest-item${i === menu.index ? ' on' : ''}`}
                onMouseDown={e => { e.preventDefault(); menu.command(item); }}
                onMouseEnter={() => setMenu(m => m && { ...m, index: i })}>
                <span className="suggest-icon"><Icon size={15} /></span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.kind === 'create' ? `Create “${item.title}”` : item.title}
                  </span>
                  {item.desc && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>{item.desc}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Below the cursor, or above it when there's no room.
function menuPosition(rect) {
  const height = 320;
  const below = rect.bottom + 8 + height < window.innerHeight;
  return {
    position: 'fixed', zIndex: 200,
    left: Math.min(rect.left, window.innerWidth - 290),
    ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }),
  };
}
