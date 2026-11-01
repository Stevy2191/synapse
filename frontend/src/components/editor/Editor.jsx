import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { synapseEditorTheme } from './cmTheme';
import { markdownToHtml, htmlToMarkdown, DIAGRAM_FENCE, convertCallouts } from './convert';
import { CALLOUTS } from './blocks';
import { EditorView } from '@codemirror/view';
import { keymap } from '@codemirror/view';
import { Marked } from 'marked';
import { languages as codeLanguages } from '@codemirror/language-data';
import { highlightToHtml } from './codeLanguages';
import DOMPurify from 'dompurify';
import {
  Eye, Edit, Columns, Tag, Type, Code2, Bold, Italic, Underline, List, ListOrdered, Code, Quote, Minus, Link,
  PanelLeft, PanelRight, ChevronRight, ArrowUpRight, ArrowDownLeft, Plus, Search, Image as ImageIcon, ListChecks,
} from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { saveNote, openNote, openNoteByTitle, createNote, refreshActiveLinks } from '../../offline/sync';
import toast from 'react-hot-toast';
import RichEditor from './RichEditor';
import DiagramEditor from './DiagramEditor';
import FreeDrawEditor from './FreeDrawEditor';
import Logo from '../Logo';
import { WorkspaceIcon } from '../Avatar';
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
  const withLinks = content.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link" data-link="$1">$1</span>');
  const html = DOMPurify.sanitize(previewMarked.parse(withLinks), { ADD_ATTR: ['data-link'] });
  if (!/\[!|\[TOC\]/i.test(html)) return html;
  // Callouts ("> [!NOTE]") and a table of contents ("[TOC]")
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  convertCallouts(doc, (box, type) => {
    box.setAttribute('data-callout', type);
    const title = doc.createElement('div');
    title.className = 'callout-title';
    title.textContent = CALLOUTS[type].label;
    box.prepend(title);
  });
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
  const saveTimer = useRef(null);
  const richEditorRef = useRef(null);
  const cmRef = useRef(null);

  useEffect(() => {
    if (activeNote?.note) {
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
      await saveNote(noteId, { title: t, content: c, rich_content: rc, tags: tg, editor_mode: mode });
      updateNoteInTree(noteId, { title: t, tags: JSON.stringify(tg) });
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
    setTitle(e.target.value);
    schedSave(e.target.value, content, richContent, tags, editorMode);
  };

  const handleContentChange = (val) => {
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
    setRichContent(html);
    schedSave(title, content, html, tags, editorMode);
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
  const handleMarkdownFormat = useCallback((action) => {
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
      saveNote(noteId, { canvas_data: canvasData }).catch(() => toast.error('Could not save on this device'));
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
      <input value={title} onChange={handleTitleChange} placeholder="Untitled" className="doc-title" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '12px 0 28px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        {tags.map(tag => (
          <span key={tag} className="tag-chip" onClick={() => removeTag(tag)} title="Remove tag">#{tag}</span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Tag size={12} />
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
            onBlur={addTag}
            placeholder="Add tag"
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-secondary)', font: '400 12.5px var(--font-sans)', width: 70 }}
          />
        </span>
        <span>· Edited {timeAgo(activeNote.note.updated_at)}</span>
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
    <div className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      onClick={e => { const link = e.target.closest('.wiki-link'); if (link) openNoteByTitle(activeWorkspace.id, link.dataset.link); }}
    />
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>

      {/* Breadcrumb bar */}
      <div style={topBar}>
        {sidebarButton}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1, fontSize: 13, color: 'var(--text-muted)' }}>
          <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}><WorkspaceIcon workspace={activeWorkspace} size={16} />{activeWorkspace?.name}</span>
          {crumbs.map(c => (
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
        {railButton}
      </div>

      {/* Formatting toolbar */}
      {isMarkdown && showEditor && <MarkdownToolbar onFormat={handleMarkdownFormat} />}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!isNote && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ padding: '18px 24px 0' }}>{titleBlock}</div>
            <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', borderTop: '1px solid var(--border-subtle)' }}>
              {noteType === 'diagram' && <DiagramEditor canvasData={activeNote.note.canvas_data} onChange={handleCanvasChange} />}
              {noteType === 'draw' && <FreeDrawEditor canvasData={activeNote.note.canvas_data} onChange={handleCanvasChange} />}
            </div>
          </div>
        )}

        {isNote && editorMode === 'rich' && (
          <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }} onClick={e => { if (e.target === e.currentTarget) richEditorRef.current?.commands.focus('end'); }}>
            <div className="doc-column">
              {titleBlock}
              <RichEditor key={activeNote.note.id} content={richContent} onChange={handleRichContentChange} editorRef={richEditorRef} />
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

        {rightRailOpen && <RightRail activeNote={activeNote} />}
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
