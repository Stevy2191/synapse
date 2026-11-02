import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
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
import {
  Bold, Italic, Underline, Strikethrough, Code, Link as LinkIcon, Quote, Highlighter, Heading1, Heading2, Heading3,
  Type, ListChecks, ListTodo, Paperclip, ScanText, PenLine, List, ListOrdered, Code2, Table as TableIcon, Minus, Image as ImageIcon, FileText, Plus,
  ArrowDownToLine, ArrowRightToLine, Trash2, GitFork, Pencil, Workflow, PenTool,
  Sparkles, Youtube, Sigma, Radical, Waypoints, ListCollapse, Info, Lightbulb, TriangleAlert, OctagonAlert, ImageUp, FilePlus, ListTree, CalendarDays, Clock, CalendarClock,
} from 'lucide-react';
import { SlashCommand, WikiLinkSuggest, WikiLinkDecorations } from './extensions';
import { kindInfo } from '../noteKinds';
import { Callout, TableOfContents, ToggleBlocks } from './blocks';
import { Mathematics } from '@tiptap/extension-mathematics';
import { VideoEmbed, MathDialog } from './embeds';
import { FileLink } from './FileLink';
import { DrawingEmbed, DrawingPicker } from '../freedraw/DrawingEmbed';
import { DiagramNode } from '../diagrams/DiagramNode';
import { CodeBlock } from './CodeBlockView';
import ColorPicker from '../ColorPicker';
import TurnInto from './TurnInto';

// Is this toggle title the name of a task list (a toggle holding a checklist)?
function isTaskListTitle(ed, pos) {
  try {
    const details = ed.state.doc.resolve(pos).parent;
    let found = false;
    details.descendants(n => { if (n.type.name === 'taskList') found = true; return !found; });
    return found;
  } catch { return false; }
}

const SLASH_ICONS = {
  text: Type, h1: Heading1, h2: Heading2, h3: Heading3, todo: ListChecks, ul: List, ol: ListOrdered,
  link: FileText, quote: Quote, code: Code2, table: TableIcon, divider: Minus, image: ImageIcon,
  drawio: Workflow, excalidraw: PenTool, toggle: ListCollapse, tasklist: ListTodo, file: Paperclip, ocr: ScanText, upload: ImageUp, subnote: FilePlus, toc: ListTree,
  ai: Sparkles, 'callout-info': Info, 'callout-tip': Lightbulb, 'callout-warning': TriangleAlert, 'callout-danger': OctagonAlert,
  date: CalendarDays, time: Clock, datetime: CalendarClock, video: Youtube, drawing: PenTool, math: Sigma, 'math-inline': Radical, mermaid: Waypoints,
};
const COLORS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#7c7bff', '#a855f7', '#ec4899'];
const HIGHLIGHTS = ['#fef08a', '#fde68a', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#fecaca'];

/**
 * The default note editor, in the style of Outline: what you see is the finished note.
 *  - Markdown shortcuts while typing: "# " heading, "**bold**", "- " list, "[] " checklist, "> " quote, "```" code
 *  - "/" opens a menu of blocks; "[[" links to another note
 *  - Selecting text shows a formatting toolbar; inside a table, table controls appear
 * Content is HTML; the page also keeps a Markdown copy for search, links and the Markdown view.
 */
export default function RichEditor({ content, onChange, editorRef: editorRefProp, onAi, editable = true, onEditor, onPickFile, onReadText }) {
  const lastHtmlRef = useRef(content);
  const isFirstLoad = useRef(true);
  const [menu, setMenu] = useState(null); // { kind, items, index, rect, command }
  const [math, setMath] = useState(null);   // math dialog: { inline, latex, pos, editing }
  const [drawingPicker, setDrawingPicker] = useState(false);
  const mathClick = useRef(() => {});
  mathClick.current = (node, pos) => setMath({ inline: node.type.name === 'inlineMath', latex: node.attrs.latex, pos, editing: true });
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
        includeChildren: true,
        placeholder: ({ node, pos, editor: ed }) => (node.type.name === 'heading' ? 'Heading'
          : node.type.name === 'detailsSummary' ? (isTaskListTitle(ed, pos) ? 'Task list name' : 'Toggle title')
          : 'Type / for blocks, [[ to link a note…'),
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlock,
      Image.configure({ inline: false, allowBase64: true }),
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
      Callout,
      TableOfContents,
      ...ToggleBlocks,
      VideoEmbed,
      FileLink,
      DrawingEmbed,
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        blockOptions: { onClick: (node, pos) => mathClick.current(node, pos) },
        inlineOptions: { onClick: (node, pos) => mathClick.current(node, pos) },
      }),
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
    onEditor?.(editor);
  }, [editor, editorRefProp]);

  // "/" → File, or the formatting bar's paperclip: open the file picker (Editor.jsx owns it).
  const pickFileRef = useRef(onPickFile);
  pickFileRef.current = onPickFile;
  const readTextRef = useRef(onReadText);
  readTextRef.current = onReadText;
  useEffect(() => {
    if (!editor) return undefined;
    const open = () => pickFileRef.current?.();
    const read = arg => readTextRef.current?.(arg);
    editor.on('synapse:pickFile', open);
    editor.on('synapse:readText', read);
    return () => { editor.off('synapse:pickFile', open); editor.off('synapse:readText', read); };
  }, [editor]);

  // "/" → Math opens the equation dialog
  useEffect(() => {
    if (!editor) return undefined;
    const open = ({ inline }) => setMath({ inline, latex: '', pos: null, editing: false });
    const openDrawing = () => setDrawingPicker(true);
    const openAi = (opts) => onAiRef.current?.(opts || {});
    editor.on('synapse:math', open);
    editor.on('synapse:drawing', openDrawing);
    editor.on('synapse:ai', openAi);
    return () => { editor.off('synapse:math', open); editor.off('synapse:drawing', openDrawing); editor.off('synapse:ai', openAi); };
  }, [editor]);
  // Shared notes: read-only for viewers, and while someone else has the editing turn.
  useEffect(() => { if (editor && editor.isEditable !== editable) editor.setEditable(editable); }, [editor, editable]);
  const onAiRef = useRef(onAi);
  onAiRef.current = onAi;

  const saveMath = (latex, inline) => {
    const m = math;
    setMath(null);
    if (m.editing) {
      if (inline) editor.chain().focus().updateInlineMath({ latex, pos: m.pos }).run();
      else editor.chain().focus().updateBlockMath({ latex, pos: m.pos }).run();
    } else if (inline) {
      editor.chain().focus().insertInlineMath({ latex }).run();
    } else {
      editor.chain().focus().insertContent([{ type: 'blockMath', attrs: { latex } }, { type: 'paragraph' }]).run();
    }
  };
  const deleteMath = () => {
    const m = math;
    setMath(null);
    if (m.inline) editor.chain().focus().deleteInlineMath({ pos: m.pos }).run();
    else editor.chain().focus().deleteBlockMath({ pos: m.pos }).run();
  };

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
          .rich-editor-content p.is-editor-empty:first-child::before,
          .rich-editor-content summary.is-empty::before,
          .rich-editor-content .callout p.is-empty::before,
          .rich-editor-content [data-type="detailsContent"] p.is-empty::before {
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
          .rich-editor-content hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
          .rich-editor-content img { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }
          .rich-editor-content a { color: var(--accent); text-decoration: none; }
          .rich-editor-content a:hover { text-decoration: underline; }
          .rich-editor-content table { border-collapse: collapse; width: 100%; margin: 1em 0; }
          .rich-editor-content td, .rich-editor-content th { border: 1px solid var(--border); padding: 8px 12px; min-width: 60px; }
          .rich-editor-content th { background: var(--bg-elevated); font-weight: 600; }
          .rich-editor-content .selectedCell { background: var(--accent-subtle); }
          .ProseMirror-selectednode { outline: 2px solid var(--accent); border-radius: 4px; }
        `}</style>

      {/* Formatting toolbar: appears over selected text */}
      <BubbleMenu editor={editor} pluginKey="formatMenu"
        shouldShow={({ editor: ed, state }) => ed.isEditable && !state.selection.empty && !state.selection.node && !ed.isActive('codeBlock') && !ed.isActive('image') && !ed.isActive('diagram')}
        options={{ placement: 'top', offset: 8 }}>
        <div className="floating-menu">
          {onAi && (
            <>
              <button type="button" className="ai-bubble-btn" title="Ask AI about the selected text"
                onMouseDown={e => { e.preventDefault(); onAi({}); }}><Sparkles size={14} /> AI</button>
              <Sep />
            </>
          )}
          <TurnInto editor={editor} />
          <Sep />
          <B on={editor.isActive('bold')} title="Bold (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></B>
          <B on={editor.isActive('italic')} title="Italic (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></B>
          <B on={editor.isActive('underline')} title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15} /></B>
          <B on={editor.isActive('strike')} title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></B>
          <B on={editor.isActive('code')} title="Inline code" onClick={() => editor.chain().focus().toggleCode().run()}><Code size={15} /></B>
          <Sep />
          <B on={editor.isActive('link')} title="Link" onClick={setLink}><LinkIcon size={15} /></B>
          <B on={editor.isActive('highlight')} title="Highlight" onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={15} /></B>
          <ColorPicker inline icon={<Highlighter size={13} />} title="Highlight colour…" presets={HIGHLIGHTS}
            value={editor.getAttributes('highlight').color}
            onChange={color => editor.chain().focus().setHighlight({ color }).run()} />
          <span className="color-row">
            {COLORS.map(c => (
              <button key={c || 'none'} title={c ? 'Text colour' : 'Default colour'}
                onMouseDown={e => { e.preventDefault(); c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run(); }}
                style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--border)', cursor: 'pointer', padding: 0,
                  background: c || 'var(--text-primary)', outline: editor.isActive('textStyle', { color: c }) ? '2px solid var(--accent)' : 'none' }} />
            ))}
            <ColorPicker inline size={16} title="Any text colour…" presets={COLORS.filter(Boolean)}
              value={editor.getAttributes('textStyle').color}
              onChange={color => editor.chain().focus().setColor(color).run()} />
          </span>
        </div>
      </BubbleMenu>

      {/* Picture: read the text in it (OCR / handwriting via AI) */}
      {onReadText && (
        <BubbleMenu editor={editor} pluginKey="imageMenu"
          shouldShow={({ editor: ed }) => ed.isEditable && ed.isActive('image')}
          options={{ placement: 'top', offset: 8 }}>
          <div className="floating-menu">
            <B title="Read the printed text in this picture" onClick={() => onReadText({ source: editor.getAttributes('image').src, mode: 'print', after: true })}><ScanText size={15} /> Read text</B>
            <B title="Read handwriting in this picture — uses your AI assistant" onClick={() => onReadText({ source: editor.getAttributes('image').src, mode: 'handwriting', after: true })}><PenLine size={15} /> Handwriting</B>
          </div>
        </BubbleMenu>
      )}

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

      {drawingPicker && <DrawingPicker onClose={() => { setDrawingPicker(false); editor.commands.focus(); }}
        onPick={title => { setDrawingPicker(false); editor.chain().focus().insertContent([{ type: 'drawingEmbed', attrs: { title } }, { type: 'paragraph' }]).run(); }} />}
      {math && <MathDialog initial={math.latex} inline={math.inline} editing={math.editing}
        onSave={saveMath} onDelete={deleteMath} onClose={() => { setMath(null); editor.commands.focus(); }} />}

      {/* "/" and "[[" menus */}
      {menu && menu.rect && menu.items.length > 0 && (
        <div className="suggest-menu fade-in" style={menuPosition(menu.rect)}>
          {menu.kind !== 'slash' && <div className="section-label" style={{ padding: '6px 10px 4px' }}>Link to note</div>}
          {menu.items.map((item, i) => {
            const Icon = menu.kind === 'slash' ? (SLASH_ICONS[item.id] || Plus) : item.kind === 'create' ? Plus : kindInfo({ kind: item.noteKind, note_type: item.noteType }).icon;
            const groupStart = menu.kind === 'slash' && item.group !== menu.items[i - 1]?.group;
            return (
              <div key={item.id}>
              {groupStart && <div className={`section-label suggest-group${i > 0 ? ' sep' : ''}`}>{item.group}</div>}
              <button className={`suggest-item${i === menu.index ? ' on' : ''}`}
                ref={i === menu.index ? el => el?.scrollIntoView({ block: 'nearest' }) : undefined}
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Below the cursor, or above it when there's no room.
function menuPosition(rect) {
  const height = 380;
  const below = rect.bottom + 8 + height < window.innerHeight;
  return {
    position: 'fixed', zIndex: 200,
    left: Math.min(rect.left, window.innerWidth - 290),
    ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }),
  };
}
