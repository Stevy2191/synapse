import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { synapseEditorTheme } from './cmTheme';
import { markdownToHtml, htmlToMarkdown, DIAGRAM_FENCE, convertCallouts } from './convert';
import { CALLOUTS } from './blocks';
import { noteKind, isUntitled, nameForDiagramNote } from '../noteKinds';
import { drawingPreview } from '../freedraw/DrawingEmbed';
import { extractMath, restoreMath, renderMath, videoElementHtml, renderMermaid } from './embeds';
import { EditorView } from '@codemirror/view';
import { keymap } from '@codemirror/view';
import { Marked } from 'marked';
import { languages as codeLanguages } from '@codemirror/language-data';
import { highlightToHtml } from './codeLanguages';
import DOMPurify from 'dompurify';
import {
  Eye, Edit, Columns, Tag, Type, Code2, Bold, Italic, Underline, List, ListOrdered, Code, Quote, Minus, Link,
  PanelLeft, PanelRight, ChevronRight, ArrowUpRight, ArrowDownLeft, Plus, Search, Image as ImageIcon, ListChecks, Download, MessageCircle, Sparkles, Users, History, Eye as EyeIcon, Lock, Globe,
} from 'lucide-react';
import { PanelTop } from 'lucide-react';
import RichToolbar from './RichToolbar';
import FilePicker from '../files/FilePicker';
import ReadTextDialog from '../ocr/ReadTextDialog';
import { RecordDialog, beginMeeting } from '../meetings/Recorder';
import { useRecorder } from '../../meetings/client';
import { attachCopy, fetchFile, fileHref } from '../../files/client';
import { fitImage } from '../../utils/image';
import { Paperclip, ScanText } from 'lucide-react';
import ExportDialog from './ExportDialog';
import ChatRoom from '../chat/ChatRoom';
import { NewChatDialog } from '../chat/ChatDialogs';
import { chatForNote, useChat } from '../../chat/client';
import { useStore } from '../../stores/useStore';
import { saveNote, openNote, openNoteByTitle, createNote, refreshActiveLinks } from '../../offline/sync';
import toast from 'react-hot-toast';
import RichEditor from './RichEditor';
import DiagramEditor from './DiagramEditor';
import FreeDrawEditor from './FreeDrawEditor';
import Logo from '../Logo';
import { WorkspaceIcon, workspaceSettings } from '../Avatar';
import AiPanel from '../ai/AiPanel';
import ShareDialog from '../share/ShareDialog';
import HistoryPanel from '../share/HistoryPanel';
import PublishDialog from '../share/PublishDialog';
import { listLinks, rememberLinks, noteSaved as publishNoteSaved } from '../../publish/client';
import { useShares, getNoteShares, saveSharedNote, takeTurn, releaseTurn } from '../../shares/client';
import { userName as personNameById } from '../../chat/client';
import { storeServerNote } from '../../offline/sync';
import { DOMSerializer } from '@tiptap/pm/model';
import CalendarPanel from '../calendar/CalendarPanel';

// The preview's own Markdown renderer, with colored code blocks (convert.js keeps a plain one
// for turning Markdown into editor content).
const previewMarked = new Marked({ breaks: true, gfm: true });
previewMarked.use({
  renderer: {
    code(code, infostring) {
      const lang = (infostring || '').trim().split(/\s+/)[0] || '';
      const cls = lang ? ` language-${lang.replace(/[^\w+#-]/g, '')}` : '';
      return `<pre><code class="hljs${cls}">${highlightToHtml(code, lang)}</code></pre>\n`;
    },
  },
});

// Auto-continue lists and todos on Enter
function listContinuation(onContentChange) {
  return keymap.of([{
    key: 'Enter',
    run(view) {
      const state = view.state;
      const { from } = state.selection.main;
      const line = state.doc.lineAt(from);
      const lineText = line.text;

      // Match todo: - [ ] or - [x]
      const todoMatch = lineText.match(/^(\s*- \[[ x]\] )(.*)/);
      if (todoMatch) {
        if (todoMatch[2].trim() === '') {
          // Empty todo — exit the list
          view.dispatch({ changes: { from: line.from, to: from, insert: '' }, selection: { anchor: line.from } });
        } else {
          // Continue with new empty checkbox
          const insert = `\n${todoMatch[1].replace(/\[x\]/, '[ ]')}`;
          view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length } });
        }
        onContentChange(view.state.doc.toString());
        return true;
      }

      // Match bullet: - or *
      const ulMatch = lineText.match(/^(\s*[-*] )(.*)/);
      if (ulMatch) {
        if (ulMatch[2].trim() === '') {
          view.dispatch({ changes: { from: line.from, to: from, insert: '' }, selection: { anchor: line.from } });
        } else {
          const insert = `\n${ulMatch[1]}`;
          view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length } });
        }
        onContentChange(view.state.doc.toString());
        return true;
      }

      // Match numbered list: 1.
      const olMatch = lineText.match(/^(\s*)(\d+)\. (.*)/);
      if (olMatch) {
        if (olMatch[3].trim() === '') {
          view.dispatch({ changes: { from: line.from, to: from, insert: '' }, selection: { anchor: line.from } });
        } else {
          const nextNum = parseInt(olMatch[2]) + 1;
          const insert = `\n${olMatch[1]}${nextNum}. `;
          view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length } });
        }
        onContentChange(view.state.doc.toString());
        return true;
      }

      return false;
    }
  }]);
}

function renderMarkdown(content) {
  content = content.replace(DIAGRAM_FENCE, (m, json) => {
    try {
      const d = JSON.parse(json);
      return d.preview?.startsWith('data:image/') ? `\n\n![${d.kind === 'excalidraw' ? 'Excalidraw drawing' : 'draw.io diagram'}](${d.preview})\n\n` : '';
    } catch { return ''; }
  });
  // "![[Drawing]]" on its own line: a placeholder that PreviewHtml fills with the drawing's picture
  content = content.replace(/^!\[\[([^\[\]\n]+)\]\]\s*$/gm, (m, t) => `\n<div class="drawing-embed" data-drawing="${t.trim().replace(/"/g, '&quot;')}"></div>\n`);
  const withLinks = content.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link" data-link="$1">$1</span>');
  const math = extractMath(withLinks);
  let html = DOMPurify.sanitize(previewMarked.parse(math.md), { ADD_ATTR: ['data-link'] });
  html = restoreMath(html, math.items, m => (m.block ? `<div class="math-block">${renderMath(m.latex, true)}</div>` : renderMath(m.latex, false)));
  if (!/\[!|\[TOC\]|>▶/i.test(html)) return html;
  // Callouts ("> [!NOTE]") and a table of contents ("[TOC]")
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  convertCallouts(doc, (box, type) => {
    box.setAttribute('data-callout', type);
    const title = doc.createElement('div');
    title.className = 'callout-title';
    title.textContent = CALLOUTS[type].label;
    box.prepend(title);
  });
  // "[▶ Video](link)" on its own line plays the video
  for (const p of doc.querySelectorAll('p')) {
    const a = p.children.length === 1 ? p.querySelector(':scope > a') : null;
    if (!a || p.textContent.trim() !== a.textContent.trim() || !a.textContent.trim().startsWith('▶')) continue;
    const v = videoElementHtml(a.getAttribute('href'));
    if (v) p.outerHTML = v;
  }
  for (const p of doc.querySelectorAll('p')) {
    if (p.textContent.trim().toUpperCase() !== '[TOC]') continue;
    const toc = doc.createElement('div');
    toc.className = 'toc-block';
    toc.innerHTML = '<div class="toc-head">Contents</div>';
    const hs = [...doc.querySelectorAll('h1, h2, h3, h4')];
    const top = Math.min(3, ...hs.map(h => +h.tagName[1]));
    for (const h of hs) {
      const item = doc.createElement('div');
      item.className = 'toc-item';
      item.style.paddingLeft = `${8 + (+h.tagName[1] - top) * 16}px`;
      item.textContent = h.textContent;
      toc.appendChild(item);
    }
    p.replaceWith(toc);
  }
  return doc.body.innerHTML;
}

// The rendered Markdown. Mermaid code blocks are drawn as charts once the HTML is on the page.
function PreviewHtml({ html, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    let cancelled = false;
    for (const code of ref.current?.querySelectorAll('pre > code.language-mermaid') || []) {
      renderMermaid(code.textContent).then(r => {
        if (cancelled || !r.svg || !code.isConnected) return;
        const div = document.createElement('div');
        div.className = 'mermaid-preview';
        div.innerHTML = r.svg;
        code.parentElement.replaceWith(div);
      });
    }
    const ws = useStore.getState().activeWorkspace;
    for (const box of ref.current?.querySelectorAll('.drawing-embed[data-drawing]') || []) {
      if (!ws) break;
      drawingPreview(ws.id, box.getAttribute('data-drawing')).then(({ note, preview }) => {
        if (cancelled || !box.isConnected) return;
        box.innerHTML = '';
        if (preview) { const img = document.createElement('img'); img.src = preview; img.alt = note.title; box.appendChild(img); }
        else box.textContent = note ? 'Empty drawing' : `No drawing called “${box.getAttribute('data-drawing')}”`;
        if (note) { box.style.cursor = 'pointer'; box.onclick = () => openNote(note.id); }
      });
    }
    return () => { cancelled = true; };
  }, [html]);
  return <div ref={ref} className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} onClick={onClick} />;
}

// Markdown formatting toolbar - inserts markdown syntax into CodeMirror
function MarkdownToolbar({ onFormat }) {
  const items = [
    ['bold', <Bold size={14} />, 'Bold'], ['italic', <Italic size={14} />, 'Italic'], ['underline', <Underline size={14} />, 'Underline'],
    '|',
    ['h1', <b style={{ font: '700 12px var(--font-sans)' }}>H1</b>, 'Heading 1'], ['h2', <b style={{ font: '700 12px var(--font-sans)' }}>H2</b>, 'Heading 2'], ['h3', <b style={{ font: '700 12px var(--font-sans)' }}>H3</b>, 'Heading 3'],
    '|',
    ['ul', <List size={14} />, 'Bullet list'], ['ol', <ListOrdered size={14} />, 'Numbered list'], ['todo', <ListChecks size={14} />, 'Checklist'],
    '|',
    ['quote', <Quote size={14} />, 'Quote'], ['inlinecode', <Code size={14} />, 'Inline code'], ['codeblock', <Code2 size={14} />, 'Code block'],
    '|',
    ['hr', <Minus size={14} />, 'Divider'], ['link', <Link size={14} />, 'Link'], ['image', <ImageIcon size={14} />, 'Image'],
    ['file', <Paperclip size={14} />, 'File from a folder or drive'],
    ['ocr', <ScanText size={14} />, 'Text from a picture or PDF'],
  ];
  return (
    <div style={toolbarRow}>
      {items.map((it, i) => it === '|'
        ? <div key={i} style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />
        : <button key={it[0]} className="btn-ghost" title={it[2]} onMouseDown={e => { e.preventDefault(); onFormat(it[0]); }}>{it[1]}</button>
      )}
    </div>
  );
}

const toolbarRow = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, padding: '5px 14px',
  borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-base)', flexShrink: 0, minHeight: 42,
};

function timeAgo(seconds) {
  if (!seconds) return '';
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

// Small radial graph of the open note and everything it links with.
function ConnectionsGraph({ note, links }) {
  const unique = [...new Map(links.map(l => [l.id, l])).values()].slice(0, 10);
  const W = 228, H = 150, cx = W / 2, cy = H / 2;
  const nodes = unique.map((l, i) => {
    const a = (i / Math.max(unique.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = unique.length > 5 ? 56 : 50;
    return { ...l, x: cx + Math.cos(a) * r * 1.45, y: cy + Math.sin(a) * r };
  });
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="card" style={{ display: 'block', background: 'radial-gradient(circle at 50% 50%, var(--accent-subtle), transparent 70%)' }}>
      {nodes.map(n => (
        <line key={'l' + n.id} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.2"
          strokeDasharray={n.direction === 'incoming' ? '3 3' : undefined} />
      ))}
      {nodes.map(n => (
        <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => openNote(n.id)}>
          <title>{n.title}</title>
          <circle cx={n.x} cy={n.y} r="5" fill="var(--accent)" />
        </g>
      ))}
      <circle cx={cx} cy={cy} r="9" fill="var(--accent-hover)" style={{ filter: 'drop-shadow(var(--glow))' }} />
      {unique.length === 0 && (
        <text x={cx} y={cy + 28} textAnchor="middle" fill="var(--text-muted)" style={{ font: '500 11px var(--font-sans)' }}>No links yet</text>
      )}
    </svg>
  );
}

// The right-hand panel: Calendar, and (with a note open) its Connections.
function RightRail({ activeNote }) {
  const { tab, setTab } = useStore(s => ({ tab: s.rightRailTab, setTab: s.setRightRailTab }));
  const current = activeNote ? tab : 'calendar';
  return (
    <aside style={{ width: 280, flexShrink: 0, borderLeft: '1px solid var(--border-subtle)', padding: '14px 16px 20px', overflow: 'auto' }} className="right-rail">
      {activeNote && (
        <div className="seg" style={{ marginBottom: 14 }}>
          {[['calendar', 'Calendar'], ['links', 'Connections']].map(([id, label]) => (
            <button key={id} className={current === id ? 'on' : ''} onClick={() => setTab(id)} style={{ flex: 1, justifyContent: 'center' }}>{label}</button>
          ))}
        </div>
      )}
      {current === 'calendar' ? <CalendarPanel /> : <LinksPanel activeNote={activeNote} />}
    </aside>
  );
}

function LinksPanel({ activeNote }) {
  const outgoing = activeNote.links.filter(l => l.direction === 'outgoing');
  const incoming = activeNote.links.filter(l => l.direction === 'incoming');
  const list = (items, Icon, empty) => items.length === 0
    ? <p style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '2px 2px 6px' }}>{empty}</p>
    : items.map(l => (
      <button key={l.id} className="nav-item" onClick={() => openNote(l.id)} style={{ marginBottom: 2 }}>
        <Icon size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
      </button>
    ));
  return (
    <div>
      <div className="section-label" style={{ marginBottom: 10 }}>Connections</div>
      <ConnectionsGraph note={activeNote.note} links={activeNote.links} />
      <div className="section-label" style={{ margin: '20px 0 8px' }}>Links to</div>
      {list(outgoing, ArrowUpRight, <>Type <code style={{ fontFamily: 'var(--font-mono)' }}>[[</code> to link a note</>)}
      <div className="section-label" style={{ margin: '16px 0 8px' }}>Linked from</div>
      {list(incoming, ArrowDownLeft, 'No notes link here yet')}
    </div>
  );
}

export default function Editor() {
  const { activeNote, view, setView, updateNoteInTree, activeWorkspace, notes, syncState, sidebarOpen, setSidebarOpen, rightRailOpen, setRightRailOpen, setSearchOpen } = useStore(s => ({
    activeNote: s.activeNote, view: s.view, setView: s.setView,
    updateNoteInTree: s.updateNoteInTree, activeWorkspace: s.activeWorkspace,
    notes: s.notes, syncState: s.sync, sidebarOpen: s.sidebarOpen, setSidebarOpen: s.setSidebarOpen,
    rightRailOpen: s.rightRailOpen, setRightRailOpen: s.setRightRailOpen, setSearchOpen: s.setSearchOpen,
  }));

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');       // markdown content
  const [richContent, setRichContent] = useState(''); // HTML content for rich mode
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [editorMode, setEditorMode] = useState('markdown');
  const [linkSuggestions, setLinkSuggestions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [richEditor, setRichEditor] = useState(null);
  const richToolbar = useStore(s => s.richToolbar);
  const [exportOpen, setExportOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState(null); // what the AI window works on (see openAi)
  const [noteChat, setNoteChat] = useState(null);      // chat id shown beside the note
  const [newNoteChat, setNewNoteChat] = useState(false);
  const noteChatSummary = useChat(s => s.chats.find(c => c.note?.id === activeNote?.note?.id));
  useEffect(() => { setNoteChat(null); setNewNoteChat(false); setAiTarget(null); }, [activeNote?.note?.id]);
  // ── Sharing ──
  const myId = useStore(s => s.user?.id);
  const noteId = activeNote?.note?.id;
  const guest = !!activeNote?.shared?.guest;
  const role = guest ? activeNote.shared.role : 'owner';
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [filePicker, setFilePicker] = useState(false);
  const [readTextFor, setReadTextFor] = useState(null); // { source, mode, after, at }
  const [recordOpen, setRecordOpen] = useState(false);
  // The recorder attaches finished uploads to the open note's meeting block itself.
  useEffect(() => { useRecorder.setState({ openNoteId: activeNote?.note?.id || null }); }, [activeNote?.note?.id]);
  const [published, setPublished] = useState(0); // number of live links for my note
  const [ownerShare, setOwnerShare] = useState(null); // { count } for my own notes
  const sharedByMe = useShares(s => s.sharedByMe);
  const lock = useShares(s => (noteId ? s.locks[noteId] : null));
  const lastActivity = useRef(0);

  // Is this note of mine shared (directly or through a note it's inside)? Asked when it opens.
  useEffect(() => {
    setOwnerShare(null); setHistoryOpen(false); setShareOpen(false); setPublishOpen(false); setPublished(0);
    if (!noteId || guest) return undefined;
    let cancelled = false;
    listLinks(noteId).then(l => { if (!cancelled) { setPublished(l.filter(x => !x.expired).length); rememberLinks(noteId, l); } }).catch(() => {});
    getNoteShares(noteId).then(d => {
      if (cancelled) return;
      setOwnerShare({ count: d.shares.length + d.inherited.length });
      if (d.lock) useShares.setState(st => ({ locks: { ...st.locks, [noteId]: d.lock } }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [noteId, guest, sharedByMe]);

  const isShared = guest || (ownerShare?.count || 0) > 0;
  const lockedByOther = !!(isShared && lock && lock.user_id !== myId);
  const myTurn = !!(isShared && lock && lock.user_id === myId);

  const readOnly = role === 'view' || lockedByOther;

  // Shared notes are edited one person at a time: starting to edit takes the turn.
  const ensureTurn = async (force = false) => {
    if (!isShared || role === 'view' || !noteId) return true;
    if (myTurn && !force) return true;
    if (lockedByOther && !force) return false;
    const r = await takeTurn(noteId, { force });
    if (!r.ok) { toast.error(r.error); return false; }
    lastActivity.current = Date.now();
    // Make sure I'm editing the latest copy
    if (r.note && r.note.version !== baseVersionRef.current) {
      if (guest) useStore.getState().setActiveNote({ ...activeNote, note: { ...activeNote.note, ...r.note }, loadedAt: Date.now() });
      else await storeServerNote(r.note, { reopen: true });
    }
    return true;
  };
  const markInput = () => { userInputAt.current = Date.now(); };
  const onEditAreaFocus = () => { if (isShared && role !== 'view' && !myTurn && !lockedByOther) ensureTurn(); };

  // While it's my turn: keep it alive while I'm active, hand it back after a minute of quiet.
  useEffect(() => {
    if (!myTurn || !noteId) return undefined;
    const t = setInterval(() => {
      if (Date.now() - lastActivity.current < 60_000) takeTurn(noteId);
      else releaseTurn(noteId);
    }, 20_000);
    return () => clearInterval(t);
  }, [myTurn, noteId]);
  useEffect(() => () => { if (noteId) releaseTurn(noteId); }, [noteId]);

  const restoreVersion = async (v) => {
    if (!(await ensureTurn())) return;
    if (!confirm(`Bring back this version of “${v.title}”? The current text is kept in History, so you can undo this.`)) return;
    flushSave();
    const fields = { title: v.title, content: v.content || '', rich_content: v.rich_content, editor_mode: v.editor_mode || editorMode, ...(v.canvas_data ? { canvas_data: v.canvas_data } : {}) };
    if (guest) {
      const saved = await saveSharedNote(noteId, fields, baseVersionRef.current);
      if (saved) useStore.getState().setActiveNote({ ...activeNote, note: { ...activeNote.note, ...saved }, loadedAt: Date.now() });
    } else if (sharedRef.current) {
      const saved = await saveSharedNote(noteId, fields, baseVersionRef.current);
      if (saved) await storeServerNote(saved, { reopen: true });
    } else {
      await saveNote(noteId, fields);
      await openNote(noteId);
    }
    toast.success('Version restored');
  };

  // ── AI assistant ──
  // Works on the selected text if there is some, otherwise the whole note (or the cursor, from "/").
  const openAi = ({ fromSlash = false } = {}) => {
    if (!activeNote?.note) return;
    if (editorMode === 'rich' && richEditorRef.current) {
      const ed = richEditorRef.current;
      const sel = ed.state.selection;
      const noteText = htmlToMarkdown(ed.getHTML());
      if (!sel.empty) {
        const div = document.createElement('div');
        div.appendChild(DOMSerializer.fromSchema(ed.schema).serializeFragment(sel.content().content));
        setAiTarget({ mode: 'rich', scope: 'selection', text: htmlToMarkdown(div.innerHTML), noteText, from: sel.from, to: sel.to });
      } else setAiTarget({ mode: 'rich', scope: fromSlash ? 'cursor' : 'note', text: noteText, noteText, from: sel.from, to: sel.to });
      return;
    }
    const view = cmRef.current?.view;
    const sel = view?.state.selection.main;
    if (view && sel && !sel.empty) setAiTarget({ mode: 'markdown', scope: 'selection', text: view.state.sliceDoc(sel.from, sel.to), noteText: content, from: sel.from, to: sel.to });
    else setAiTarget({ mode: 'markdown', scope: 'note', text: content, noteText: content, from: sel?.from ?? content.length, to: sel?.to ?? content.length });
  };

  // Put the AI's reply into the note. how: 'replace' (the selection) | 'below' | 'end'
  const applyAi = (md, how) => {
    const t = aiTarget;
    if (!t) return;
    if (t.mode === 'rich' && richEditorRef.current) {
      const ed = richEditorRef.current;
      const doc = ed.state.doc;
      const html = markdownToHtml(md);
      const size = doc.content.size;
      if (how === 'replace' && t.scope === 'selection') {
        ed.chain().focus().insertContentAt({ from: Math.min(t.from, size), to: Math.min(t.to, size) }, html).run();
      } else if (how === 'end' || t.scope === 'note') {
        ed.chain().focus().insertContentAt(size, html).run();
      } else {
        const $p = doc.resolve(Math.min(t.to, size));
        if ($p.depth >= 1 && !$p.node(1).textContent.trim() && $p.node(1).isTextblock) {
          ed.chain().focus().insertContentAt({ from: $p.before(1), to: $p.after(1) }, html).run(); // fill the empty line "/ai" was typed on
        } else {
          const at = $p.depth >= 1 ? $p.after(1) : size;
          // "/ai" typed on an empty bullet or checklist line: put the reply after the list and drop that empty line.
          let empty = null;
          if ($p.parent.isTextblock && !$p.parent.textContent.trim()) {
            for (let d = $p.depth; d > 1; d--) {
              if (['listItem', 'taskItem'].includes($p.node(d).type.name) && !$p.node(d).textContent.trim()) {
                empty = $p.node(d - 1).childCount === 1 ? { from: $p.before(d - 1), to: $p.after(d - 1) } : { from: $p.before(d), to: $p.after(d) };
                break;
              }
            }
          }
          const chain = ed.chain().focus().insertContentAt(at, html);
          if (empty) chain.deleteRange(empty);
          chain.run();
        }
      }
      return;
    }
    const view = cmRef.current?.view;
    if (!view) { handleContentChange(`${content.replace(/\s+$/, '')}\n\n${md}\n`); return; }
    const len = view.state.doc.length;
    if (how === 'replace' && t.scope === 'selection') view.dispatch({ changes: { from: Math.min(t.from, len), to: Math.min(t.to, len), insert: md } });
    else if (how === 'end' || t.scope === 'note') view.dispatch({ changes: { from: len, insert: `${len ? '\n\n' : ''}${md}\n` } });
    else {
      const line = view.state.doc.lineAt(Math.min(t.to, len));
      view.dispatch({ changes: { from: line.to, insert: `\n\n${md}\n` } });
    }
  };
  const aiAllowed = workspaceSettings(activeWorkspace).ai !== 'off';

  const openNoteChat = async () => {
    if (noteChat) { setNoteChat(null); return; }
    const chat = noteChatSummary || await chatForNote(activeNote.note.id);
    if (chat) setNoteChat(chat.id);
    else setNewNoteChat(true);
  };
  const saveTimer = useRef(null);
  const richEditorRef = useRef(null);
  const cmRef = useRef(null);

  // Notes shared with me are saved straight to the server, based on the version I'm looking at.
  // Shared notes (mine or someone else's) are saved straight to the server, only while it's my
  // editing turn — so a stale copy can never overwrite someone else's changes.
  const guestRef = useRef(false);
  const sharedRef = useRef(false);      // set below once we know the note is shared
  const turnRef = useRef(false);        // it's my editing turn
  const userInputAt = useRef(0);        // last real keystroke / paste in this note
  const baseVersionRef = useRef(null);
  guestRef.current = !!activeNote?.shared?.guest;
  sharedRef.current = isShared && !guest && navigator.onLine; // offline: my own copy, queued as usual
  turnRef.current = myTurn;

  useEffect(() => {
    if (activeNote?.note) {
      baseVersionRef.current = activeNote.note.server_version ?? activeNote.note.version ?? null;
      setTitle(activeNote.note.title);
      setContent(activeNote.note.content || '');
      // Older notes may be in rich mode with only markdown saved; show that text converted.
      const rich = activeNote.note.rich_content || '';
      const md = activeNote.note.content || '';
      setRichContent(!rich.replace(/<[^>]+>/g, '').trim() && md.trim() ? markdownToHtml(md) : rich);
      setEditorMode(activeNote.note.editor_mode || 'markdown');
      try { setTags(JSON.parse(activeNote.note.tags || '[]')); } catch { setTags([]); }
      setLinkSuggestions([]);
    }
  }, [activeNote?.note?.id, activeNote?.loadedAt]);

  // Saves go to this device first (instant, works offline); offline/sync.js uploads them.
  const save = useCallback(async (noteId, t, c, rc, tg, mode) => {
    try {
      if (guestRef.current || sharedRef.current) {
        if (!turnRef.current) {
          // Only a real edit takes the turn; the editor tidying a note as it opens is not saved.
          if (Date.now() - userInputAt.current > 10_000) return;
          const r = await takeTurn(noteId);
          if (!r.ok) { toast.error(r.error); return; }
          turnRef.current = true;
        }
        lastActivity.current = Date.now();
        const saved = await saveSharedNote(noteId, { title: t, content: c, rich_content: rc, tags: tg, editor_mode: mode }, baseVersionRef.current);
        if (saved) {
          baseVersionRef.current = saved.version;
          if (!guestRef.current) { await storeServerNote(saved); updateNoteInTree(noteId, { title: t, tags: JSON.stringify(tg) }); publishNoteSaved(noteId); }
        }
        return;
      }
      await saveNote(noteId, { title: t, content: c, rich_content: rc, tags: tg, editor_mode: mode });
      publishNoteSaved(noteId);
      updateNoteInTree(noteId, { title: t, tags: JSON.stringify(tg), kind: noteKind({ note_type: useStore.getState().notes.find(n => n.id === noteId)?.note_type || 'note', content: c, rich_content: rc }) });
      refreshActiveLinks(noteId);
    } catch (err) {
      console.error(err);
      toast.error('Could not save on this device');
    } finally { setSaving(false); }
  }, []);

  const pendingSave = useRef(null);
  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (pendingSave.current) {
      const args = pendingSave.current;
      pendingSave.current = null;
      const [, , , rc, , mode] = args;
      if (mode === 'rich' && rc != null) {
        args[2] = htmlToMarkdown(rc);
        setContent(args[2]);
      }
      save(...args);
    }
  }, [save]);

  const schedSave = (t, c, rc, tg, mode) => {
    if (!activeNote?.note) return;
    setSaving(true);
    pendingSave.current = [activeNote.note.id, t, c, rc, tg, mode];
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 500);
  };

  // Don't lose the last keystrokes when switching notes or closing the tab.
  useEffect(() => flushSave, [activeNote?.note?.id, flushSave]);
  useEffect(() => {
    window.addEventListener('pagehide', flushSave);
    return () => window.removeEventListener('pagehide', flushSave);
  }, [flushSave]);

  const handleTitleChange = (e) => {
    lastActivity.current = Date.now();
    setTitle(e.target.value);
    schedSave(e.target.value, content, richContent, tags, editorMode);
  };

  const handleContentChange = (val) => {
    lastActivity.current = Date.now();
    setContent(val);
    schedSave(title, val, richContent, tags, editorMode);
    if (editorMode === 'markdown') {
      const lastOpen = val.lastIndexOf('[[');
      const lastClose = val.lastIndexOf(']]');
      if (lastOpen > lastClose) {
        const query = val.slice(lastOpen + 2);
        if (!query.includes('\n')) fetchLinkSuggestions(query);
      } else {
        setLinkSuggestions([]);
      }
    }
  };

  // The editor works in HTML; keep a Markdown copy alongside it for search, [[links]],
  // the Markdown view and export.
  // (The Markdown copy is made in flushSave, once per save rather than per keystroke.)
  const handleRichContentChange = (html) => {
    lastActivity.current = Date.now();
    setRichContent(html);
    // An "Untitled" note whose only content is a new draw.io / Excalidraw diagram gets a name,
    // so it can be told apart later ("Diagram – Nov 4").
    let t = title;
    if (isUntitled(title)) {
      const named = nameForDiagramNote(html, notes.filter(n => n.id !== activeNote?.note?.id).map(n => n.title));
      if (named) { t = named; setTitle(named); }
    }
    schedSave(t, content, html, tags, editorMode);
  };

  const fetchLinkSuggestions = (q) => {
    const needle = q.toLowerCase();
    setLinkSuggestions(notes
      .filter(n => n.id !== activeNote?.note?.id && n.title.toLowerCase().includes(needle))
      .slice(0, 10)
      .map(n => ({ id: n.id, title: n.title })));
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      const next = [...tags, t];
      setTags(next);
      schedSave(title, content, richContent, next, editorMode);
    }
    setTagInput('');
  };

  const removeTag = (tag) => {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    schedSave(title, content, richContent, next, editorMode);
  };

  // Switching modes converts the text you've been editing into the other format.
  // (If the current side is empty, the other side's existing text is kept as-is.)
  const toggleEditorMode = () => {
    flushSave();
    const next = editorMode === 'markdown' ? 'rich' : 'markdown';
    let c = content, rc = richContent;
    if (next === 'rich' && content.trim()) rc = markdownToHtml(content);
    if (next === 'markdown' && richContent && richContent.replace(/<[^>]+>/g, '').trim()) c = htmlToMarkdown(richContent);
    setContent(c);
    setRichContent(rc);
    setEditorMode(next);
    schedSave(title, c, rc, tags, next);
  };

  // Insert markdown formatting at cursor or wrap selection
  // Put a picked file into the note (Write mode: a file chip; Markdown: [📎 Name](link)).
  const insertFile = async ({ item, source, how }) => {
    const noteId = activeNote.note.id;
    let attrs;
    if (how === 'copy' && editorMode === 'rich' && /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(item.mime || '') && (item.size || 0) < 25 * 1024 * 1024) {
      // Pictures are stored inside the note (resized), like pasted ones, so they work offline.
      const f = await fetchFile({ source: source.id, id: item.id });
      const src = await fitImage(new File([f.blob], f.name, { type: f.type }));
      richEditorRef.current?.chain().focus().setImage({ src, alt: f.name.replace(/\.[^.]+$/, '') }).run();
      setTimeout(() => richEditorRef.current?.commands.focus(), 60);
      return;
    }
    if (how === 'copy') {
      flushSave();
      let att;
      try { att = await attachCopy(source.id, item.id, noteId); } catch (err) {
        if (err?.response?.status === 404 && /Note not found/.test(err.response.data?.error || '')) throw new Error('This note hasn’t reached the server yet — try again in a moment');
        throw err;
      }
      attrs = { href: fileHref({ att: att.id, name: att.name }), name: att.name, size: att.size, kind: 'copy' };
    } else {
      attrs = { href: fileHref({ source: source.id, id: item.id, web_url: item.web_url, name: item.name }), name: item.name, size: item.size, kind: 'link' };
    }
    if (editorMode === 'rich') {
      richEditorRef.current?.chain().focus().insertContent([{ type: 'fileLink', attrs }, { type: 'text', text: ' ' }]).run();
      setTimeout(() => richEditorRef.current?.commands.focus(), 60); // back to typing once the picker has closed
    } else {
      const md = `[📎 ${attrs.name.replace(/[[\]]/g, '')}](${attrs.href})`;
      const cm = cmRef.current?.view;
      if (cm) {
        const sel = cm.state.selection.main;
        cm.dispatch({ changes: { from: sel.from, to: sel.to, insert: md }, selection: { anchor: sel.from + md.length } });
        handleContentChange(cm.state.doc.toString());
      } else handleContentChange(`${content}\n${md}`);
    }
  };

  // Meetings: insert a meeting block where the cursor is, then record / upload (Recorder.jsx).
  const startMeeting = ({ mode, file, title }) => beginMeeting({
    mode, file, title, noteId: activeNote.note.id, workspaceId: activeNote.note.workspace_id,
    insert: (localId, t) => {
      richEditorRef.current?.chain().focus().insertContent([
        { type: 'meeting', attrs: { localId, title: t, status: mode === 'file' ? 'uploading' : 'recording', createdAt: Date.now() } },
        { type: 'paragraph' },
      ]).run();
    },
    remove: localId => {
      const ed = richEditorRef.current;
      if (!ed) return;
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name === 'meeting' && n.attrs.localId === localId) { ed.chain().deleteRange({ from: pos, to: pos + n.nodeSize }).run(); return false; }
        return true;
      });
    },
  });

  // Text read from a picture / PDF goes into the note (Write: paragraphs; Markdown: as typed).
  const insertReadText = text => {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (editorMode === 'rich') {
      const ed = richEditorRef.current;
      if (!ed) return;
      const looksMd = /^\s*([-*+] (\[[ xX]\] )?|\d+[.)] |#{1,6} )/m.test(clean);
      const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = looksMd ? markdownToHtml(clean) : clean.split(/\n/).map(l => `<p>${esc(l) || '<br>'}</p>`).join('');
      const at = readTextFor?.after ? ed.state.selection.to : ed.state.selection.from;
      ed.chain().focus().insertContentAt(at, html).run();
      setTimeout(() => richEditorRef.current?.commands.focus(), 60);
    } else {
      const cm = cmRef.current?.view;
      if (cm) {
        const sel = cm.state.selection.main;
        cm.dispatch({ changes: { from: sel.from, to: sel.to, insert: clean }, selection: { anchor: sel.from + clean.length } });
        handleContentChange(cm.state.doc.toString());
      } else handleContentChange(`${content}\n\n${clean}`);
    }
  };

  const handleMarkdownFormat = useCallback((action) => {
    if (action === 'file') { setFilePicker(true); return; }
    if (action === 'ocr') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,application/pdf';
      input.onchange = () => { const f = input.files?.[0]; if (f) setReadTextFor({ source: f, mode: 'print' }); };
      input.click();
      return;
    }
    const cm = cmRef.current?.view;
    if (!cm) {
      // Fallback: append to content
      const wrappers = {
        bold: '**text**', italic: '*text*', underline: '<u>text</u>',
        h1: '# ', h2: '## ', h3: '### ',
        ul: '- item', ol: '1. item', todo: '- [ ] item',
        quote: '> ', inlinecode: '`code`', codeblock: '```\ncode\n```',
        hr: '\n---\n', link: '[text](url)', image: '![alt](url)'
      };
      handleContentChange(content + '\n' + (wrappers[action] || ''));
      return;
    }

    const state = cm.state;
    const selection = state.selection.main;
    const selectedText = state.sliceDoc(selection.from, selection.to);

    let insertion = '';
    let cursorOffset = 0;

    switch (action) {
      case 'bold':        insertion = `**${selectedText || 'bold text'}**`; cursorOffset = 2; break;
      case 'italic':      insertion = `*${selectedText || 'italic text'}*`; cursorOffset = 1; break;
      case 'underline':   insertion = `<u>${selectedText || 'text'}</u>`; cursorOffset = 3; break;
      case 'h1':          insertion = `# ${selectedText || 'Heading 1'}`; cursorOffset = 2; break;
      case 'h2':          insertion = `## ${selectedText || 'Heading 2'}`; cursorOffset = 3; break;
      case 'h3':          insertion = `### ${selectedText || 'Heading 3'}`; cursorOffset = 4; break;
      case 'ul':          insertion = `- ${selectedText || ''}`; cursorOffset = 2; break;
      case 'ol':          insertion = `1. ${selectedText || ''}`; cursorOffset = 3; break;
      case 'todo':        insertion = `- [ ] ${selectedText || ''}`; cursorOffset = 6; break;
      case 'quote':       insertion = `> ${selectedText || ''}`; cursorOffset = 2; break;
      case 'inlinecode':  insertion = `\`${selectedText || 'code'}\``; cursorOffset = 1; break;
      case 'codeblock':   insertion = `\`\`\`\n${selectedText || ''}\n\`\`\``; cursorOffset = 3; break;
      case 'hr':          insertion = '\n---\n'; cursorOffset = 0; break;
      case 'link':        insertion = `[${selectedText || 'text'}](url)`; cursorOffset = 1; break;
      case 'image':       insertion = `![${selectedText || 'alt'}](url)`; cursorOffset = 2; break;
      default:            insertion = selectedText; break;
    }

    cm.dispatch({
      changes: { from: selection.from, to: selection.to, insert: insertion },
      selection: { anchor: selection.from + insertion.length }
    });
    cm.focus();

    const newContent = state.sliceDoc(0, selection.from) + insertion + state.sliceDoc(selection.to);
    handleContentChange(newContent);
  }, [content, handleContentChange]);

  const noteType = activeNote?.note?.note_type || 'note';

  const canvasTimer = useRef(null);
  const handleCanvasChange = useCallback((canvasData) => {
    const noteId = activeNote?.note?.id;
    if (!noteId) return;
    clearTimeout(canvasTimer.current);
    canvasTimer.current = setTimeout(() => {
      if (guestRef.current || sharedRef.current) {
        if (!turnRef.current) return;
        saveSharedNote(noteId, { canvas_data: canvasData }, baseVersionRef.current).then(saved => {
          if (!saved) return;
          baseVersionRef.current = saved.version;
          if (!guestRef.current) storeServerNote(saved);
        });
        return;
      }
      saveNote(noteId, { canvas_data: canvasData }).then(() => publishNoteSaved(noteId)).catch(() => toast.error('Could not save on this device'));
    }, 500);
  }, [activeNote?.note?.id]);

  // Parent chain for the breadcrumb
  const crumbs = useMemo(() => {
    const chain = [];
    let parentId = activeNote?.note?.parent_id;
    const byId = new Map(notes.map(n => [n.id, n]));
    while (parentId && byId.has(parentId) && chain.length < 6) {
      const p = byId.get(parentId);
      chain.unshift(p);
      parentId = p.parent_id;
    }
    return chain;
  }, [notes, activeNote?.note?.parent_id]);

  const railButton = (
    <button className={`btn-ghost hide-narrow${rightRailOpen ? ' on' : ''}`} onClick={() => setRightRailOpen(!rightRailOpen)} title="Calendar & connections">
      <PanelRight size={15} />
    </button>
  );

  const sidebarButton = !sidebarOpen && (
    <button className="btn-ghost" onClick={() => setSidebarOpen(true)} title="Show sidebar (Ctrl \)"><PanelLeft size={16} /></button>
  );

  if (!activeNote?.note) {
    const newNote = async () => {
      if (!activeWorkspace) return;
      const note = await createNote({ workspace_id: activeWorkspace.id, title: 'Untitled', note_type: 'note' });
      openNote(note.id);
    };
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={topBar}>{sidebarButton}<div style={{ flex: 1 }} />{railButton}</div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 18, padding: 24, textAlign: 'center' }} className="fade-in">
          <Logo size={88} style={{ filter: 'drop-shadow(var(--glow))' }} />
          <h2 className="heading-text" style={{ font: '600 28px var(--font-display)', letterSpacing: '-0.02em' }}>Your connected knowledge base</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 380 }}>
            Pick a note from the sidebar, or start a new one. Link notes by typing <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hover)' }}>[[</code>.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button onClick={newNote} style={primaryBtn}><Plus size={15} /> New note</button>
            <button onClick={() => setSearchOpen(true)} style={secondaryBtn}><Search size={14} /> Search <kbd style={kbd}>Ctrl K</kbd></button>
          </div>
        </div>
        {rightRailOpen && <RightRail activeNote={null} />}
        </div>
      </div>
    );
  }

  const showEditor = view === 'editor' || view === 'split';
  const showPreview = view === 'preview' || view === 'split';
  const isNote = noteType === 'note';
  const isMarkdown = isNote && editorMode === 'markdown';

  const titleBlock = (
    <div style={{ paddingTop: isNote ? 48 : 0 }}>
      <input value={title} onChange={handleTitleChange} placeholder="Untitled" className="doc-title" readOnly={readOnly} onFocus={onEditAreaFocus} onKeyDown={markInput} onPaste={markInput} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '12px 0 28px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        {tags.map(tag => (
          <span key={tag} className="tag-chip" onClick={() => !readOnly && removeTag(tag)} title={readOnly ? undefined : 'Remove tag'}>#{tag}</span>
        ))}
        {!readOnly && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Tag size={12} />
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
            onBlur={addTag}
            placeholder="Add tag"
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-secondary)', font: '400 12.5px var(--font-sans)', width: 70 }}
          />
        </span>}
        <span>· Edited {activeNote.note.updated_by && activeNote.note.updated_by !== myId && isShared ? `by ${personNameById(activeNote.note.updated_by)} ` : ''}{timeAgo(activeNote.note.updated_at)}</span>
      </div>
    </div>
  );

  const linkPopup = linkSuggestions.length > 0 && (
    <div className="card" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', overflow: 'hidden', zIndex: 100, minWidth: 260, boxShadow: 'var(--shadow)', background: 'var(--bg-elevated)' }}>
      <div className="section-label" style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>Link to note</div>
      {linkSuggestions.map(s => (
        <button key={s.id} className="nav-item" style={{ borderRadius: 0 }}
          onClick={() => { const lastOpen = content.lastIndexOf('[['); handleContentChange(content.slice(0, lastOpen) + `[[${s.title}]]`); setLinkSuggestions([]); }}>
          <ArrowUpRight size={13} style={{ color: 'var(--accent)' }} /> {s.title}
        </button>
      ))}
    </div>
  );

  const markdownEditor = (
    <div className="doc-cm">
      <CodeMirror
        ref={cmRef}
        editable={!readOnly}
        readOnly={readOnly}
        onFocus={onEditAreaFocus}
        onKeyDown={markInput}
        value={content}
        theme="none"
        extensions={[markdown({ codeLanguages }), synapseEditorTheme, EditorView.lineWrapping, listContinuation(handleContentChange)]}
        onChange={handleContentChange}
        placeholder="Start writing…"
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
      />
    </div>
  );

  const preview = (
    <PreviewHtml html={renderMarkdown(content)}
      onClick={e => { const link = e.target.closest('.wiki-link'); if (link) openNoteByTitle(activeWorkspace.id, link.dataset.link); }}
    />
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>

      {/* Breadcrumb bar */}
      <div style={topBar}>
        {sidebarButton}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1, fontSize: 13, color: 'var(--text-muted)' }}>
          {guest
            ? <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Users size={14} />Shared with me</span>
            : <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}><WorkspaceIcon workspace={activeWorkspace} size={16} />{activeWorkspace?.name}</span>}
          {!guest && crumbs.map(c => (
            <span key={c.id} style={{ display: 'contents' }}>
              <ChevronRight size={13} style={{ flexShrink: 0 }} />
              <button className="btn-ghost" style={{ height: 24, padding: '0 4px', fontSize: 13 }} onClick={() => openNote(c.id)}>{c.title}</button>
            </span>
          ))}
          <ChevronRight size={13} style={{ flexShrink: 0 }} />
          <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Untitled'}</span>
        </div>

        {isNote && (
          <div className="seg">
            {[['rich', <Type size={13} />, 'Write'], ['markdown', <Code2 size={13} />, 'Markdown']].map(([mode, icon, label]) => (
              <button key={mode} className={editorMode === mode ? 'on' : ''} onClick={() => { if (editorMode !== mode) toggleEditorMode(); }}>
                {icon}<span className="hide-narrow">{label}</span>
              </button>
            ))}
          </div>
        )}
        {isNote && editorMode === 'rich' && !readOnly && (
          <button className={`btn-ghost${richToolbar ? ' on' : ''}`} title={richToolbar ? 'Hide the formatting bar' : 'Show a formatting bar at the top (like in Markdown)'}
            onClick={() => useStore.setState({ richToolbar: !richToolbar })}><PanelTop size={15} /></button>
        )}
        {isMarkdown && (
          <div className="seg">
            {[['editor', <Edit size={13} />, 'Edit'], ['split', <Columns size={13} />, 'Split'], ['preview', <Eye size={13} />, 'Preview']].map(([v, icon, label]) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} title={label}>
                {icon}<span className="hide-narrow">{label}</span>
              </button>
            ))}
          </div>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' }}
          title={syncState.pending > 0 ? 'Saved on this device; waiting to upload' : 'Saved and synced'} className="hide-narrow">
          {saving ? 'Saving…' : syncState.pending > 0 ? 'Saved on device' : 'Saved'}
        </span>
        {!guest && (
          <button className={`btn-ghost${shareOpen ? ' on' : ''}`} onClick={() => { flushSave(); setShareOpen(true); }} title={isShared ? `Shared with ${ownerShare.count} ${ownerShare.count === 1 ? 'person' : 'people'} — change sharing` : 'Share this note with people on this server'} style={{ position: 'relative' }}>
            <Users size={15} /><span className="hide-narrow">{isShared ? `Shared · ${ownerShare.count}` : 'Share'}</span>
          </button>
        )}
        {!guest && (
          <button className={`btn-ghost${publishOpen ? ' on' : ''}`} onClick={() => { flushSave(); setPublishOpen(true); }} title={published ? `Published — ${published} link${published === 1 ? '' : 's'}` : 'Publish as a link anyone can open'}>
            <Globe size={15} /><span className="hide-narrow">{published ? 'Published' : 'Publish'}</span>
          </button>
        )}
        <button className={`btn-ghost${historyOpen ? ' on' : ''}`} onClick={() => { flushSave(); setHistoryOpen(h => !h); setNoteChat(null); }} title="History — who changed what, and when">
          <History size={15} /><span className="hide-narrow">History</span>
        </button>
        {isNote && aiAllowed && !guest && (
          <button className={`btn-ghost${aiTarget ? ' on' : ''}`} onClick={() => (aiTarget ? setAiTarget(null) : openAi())} title="AI assistant — works on the selected text, or the whole note">
            <Sparkles size={15} /><span className="hide-narrow">AI</span>
          </button>
        )}
        {!guest && <button className={`btn-ghost${noteChat ? ' on' : ''}`} onClick={openNoteChat} title={noteChatSummary ? 'Chat about this note' : 'Start a chat about this note'} style={{ position: 'relative' }}>
          <MessageCircle size={15} /><span className="hide-narrow">Chat</span>
          {noteChatSummary?.unread > 0 && <span className="chat-dot-badge">{noteChatSummary.unread}</span>}
        </button>}
        {!guest && <button className="btn-ghost" onClick={() => { flushSave(); setExportOpen(true); }} title="Export as PDF, Word, Markdown…">
          <Download size={15} /><span className="hide-narrow">Export</span>
        </button>}
        {railButton}
      </div>
      {exportOpen && <ExportDialog note={activeNote.note} onClose={() => setExportOpen(false)} />}
      {recordOpen && <RecordDialog defaultTitle={/meeting|sync|standup|call/i.test(title) ? title : 'Meeting'} onBegin={startMeeting} onClose={() => setRecordOpen(false)} />}
      {readTextFor && <ReadTextDialog source={readTextFor.source} defaultMode={readTextFor.mode} onInsert={insertReadText} onClose={() => setReadTextFor(null)} />}
      {filePicker && <FilePicker mode="insert" onClose={() => setFilePicker(false)} onInsert={insertFile} />}
      {publishOpen && <PublishDialog note={{ ...activeNote.note, title }} onClose={() => setPublishOpen(false)} onLinksChanged={l => setPublished(l.filter(x => !x.expired).length)} />}
      {shareOpen && <ShareDialog note={{ ...activeNote.note, title }} onClose={() => { setShareOpen(false); getNoteShares(noteId).then(d => setOwnerShare({ count: d.shares.length + d.inherited.length })).catch(() => {}); }} />}
      {aiTarget && <AiPanel key={`${aiTarget.scope}-${aiTarget.from}-${aiTarget.to}`} target={aiTarget} note={{ ...activeNote.note, title }} onApply={applyAi} onClose={() => setAiTarget(null)} />}
      {newNoteChat && <NewChatDialog note={activeNote.note} onClose={() => setNewNoteChat(false)} onCreated={c => { setNewNoteChat(false); setNoteChat(c.id); }} />}

      {/* Shared notes: who it's from, who's editing */}
      {isShared && (
        <div className={`share-banner${lockedByOther ? ' busy' : myTurn ? ' mine' : ''}`}>
          {role === 'view' ? (
            <><EyeIcon size={14} /> {guest ? <>Shared by <b>{personNameById(activeNote.shared.owner?.id) !== 'Someone' ? personNameById(activeNote.shared.owner.id) : (activeNote.shared.owner?.display_name || activeNote.shared.owner?.username)}</b> — you can view it</> : 'View only'}</>
          ) : lockedByOther ? (
            <>
              <Lock size={14} /> <span><b>{personNameById(lock.user_id)}</b> is editing — you’ll see changes as they happen.</span>
              <span style={{ flex: 1 }} />
              <button className="btn-ghost" onClick={() => { if (confirm(`${personNameById(lock.user_id)} is editing right now. Take over anyway? Anything they haven’t saved in the last moment may be lost.`)) ensureTurn(true); }}>Take over</button>
            </>
          ) : myTurn ? (
            <><Edit size={14} /> You’re editing — {guest
              ? ((activeNote.shared.people?.length || 2) > 2 ? 'everyone it’s shared with sees' : <>{activeNote.shared.owner?.display_name || activeNote.shared.owner?.username} sees</>)
              : (ownerShare?.count === 1 ? 'the person you shared it with sees' : 'the people you shared it with see')} your changes live.</>
          ) : (
            <><Users size={14} /> {guest ? <>Shared by <b>{personNameById(activeNote.shared.owner?.id) !== 'Someone' ? personNameById(activeNote.shared.owner.id) : (activeNote.shared.owner?.display_name || activeNote.shared.owner?.username)}</b> — you can edit it. </> : <>Shared with {ownerShare.count} {ownerShare.count === 1 ? 'person' : 'people'}. </>}Click into the note to start editing; one person edits at a time.</>
          )}
        </div>
      )}

      {/* Formatting toolbar */}
      {isMarkdown && showEditor && <MarkdownToolbar onFormat={handleMarkdownFormat} />}
      {isNote && editorMode === 'rich' && richToolbar && !readOnly && <RichToolbar editor={richEditor} />}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!isNote && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ padding: '18px 24px 0' }}>{titleBlock}</div>
            <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', borderTop: '1px solid var(--border-subtle)' }}>
              {readOnly && <div className="readonly-shield" title={role === 'view' ? 'You can view this but not edit it' : 'Someone else is editing'} />}
              {!readOnly && isShared && !myTurn && <div className="readonly-shield clickable" onClick={() => ensureTurn()} title="Click to start editing" />}
              {noteType === 'diagram' && <DiagramEditor canvasData={activeNote.note.canvas_data} onChange={handleCanvasChange} />}
              {noteType === 'draw' && <FreeDrawEditor key={activeNote.note.id} canvasData={activeNote.note.canvas_data} onChange={handleCanvasChange} title={title} />}
            </div>
          </div>
        )}

        {isNote && editorMode === 'rich' && (
          <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }} onClick={e => { if (e.target === e.currentTarget) richEditorRef.current?.commands.focus('end'); }}>
            <div className="doc-column">
              {titleBlock}
              <div onFocusCapture={onEditAreaFocus} onKeyDownCapture={markInput} onPasteCapture={markInput} onDropCapture={markInput}>
                <RichEditor key={activeNote.note.id} content={richContent} onChange={handleRichContentChange} editorRef={richEditorRef} onEditor={setRichEditor} onPickFile={() => setFilePicker(true)} onReadText={!readOnly ? setReadTextFor : undefined} onRecord={!readOnly && !guest ? () => setRecordOpen(true) : undefined} onAi={aiAllowed && !guest && !readOnly ? openAi : undefined} editable={!readOnly} />
              </div>
            </div>
          </div>
        )}

        {isMarkdown && view !== 'split' && (
          <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
            <div className="doc-column">
              {titleBlock}
              {showEditor ? markdownEditor : <div style={{ paddingBottom: '30vh' }}>{preview}</div>}
            </div>
          </div>
        )}

        {isMarkdown && view === 'split' && (
          <>
            <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
              <div className="doc-column" style={{ maxWidth: 640, padding: '0 28px' }}>{titleBlock}{markdownEditor}</div>
            </div>
            <div style={{ width: 1, background: 'var(--border-subtle)', flexShrink: 0 }} />
            <div style={{ flex: 1, overflow: 'auto', minWidth: 0, background: 'var(--bg-surface)' }}>
              <div className="doc-column" style={{ maxWidth: 640, padding: '48px 28px 30vh' }}>{preview}</div>
            </div>
          </>
        )}

        {historyOpen ? <div className="note-chat-panel"><HistoryPanel noteId={noteId} canRestore={role !== 'view'} onRestore={restoreVersion} onClose={() => setHistoryOpen(false)} /></div> : noteChat ? <div className="note-chat-panel"><ChatRoom chatId={noteChat} compact onClose={() => setNoteChat(null)} /></div> : rightRailOpen && <RightRail activeNote={activeNote} />}
      </div>
      {linkPopup}
    </div>
  );
}

const topBar = {
  height: 50, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 16px', flexShrink: 0,
  borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
};
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none',
  background: 'var(--accent)', color: '#fff', font: '600 13.5px var(--font-sans)', cursor: 'pointer', boxShadow: 'var(--glow)',
};
const secondaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 9,
  border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)',
  font: '500 13.5px var(--font-sans)', cursor: 'pointer',
};
const kbd = { font: '500 10.5px var(--font-sans)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 5px', color: 'var(--text-muted)' };
