import { useState, useEffect, useRef, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Eye, Edit, Columns, Link2, Tag, Type, Code2, Bold, Italic, Underline, List, ListOrdered, Code, Quote, Minus, Link } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import api from '../../api';
import toast from 'react-hot-toast';
import RichEditor from './RichEditor';
import DiagramEditor from './DiagramEditor';
import FreeDrawEditor from './FreeDrawEditor';

marked.setOptions({ breaks: true, gfm: true });

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
  const withLinks = content.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link" data-link="$1">$1</span>');
  return DOMPurify.sanitize(marked.parse(withLinks), { ADD_ATTR: ['data-link'] });
}

// Markdown formatting toolbar - inserts markdown syntax into CodeMirror
function MarkdownToolbar({ onFormat }) {
  const btn = (label, icon, action, title) => (
    <button
      key={label}
      onMouseDown={e => { e.preventDefault(); onFormat(action); }}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 26, height: 26, padding: '0 4px', border: 'none', borderRadius: 5,
        cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)',
        fontSize: 12, fontWeight: 600, transition: 'all 0.12s', flexShrink: 0,
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {icon}
    </button>
  );

  const divider = (key) => <div key={key} style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px', flexShrink: 0 }} />;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2,
      padding: '4px 8px', background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)', flexShrink: 0, minHeight: 38,
    }}>
      {btn('bold',      <Bold size={13}/>,          'bold',        'Bold')}
      {btn('italic',    <Italic size={13}/>,         'italic',      'Italic')}
      {btn('underline', <Underline size={13}/>,      'underline',   'Underline')}
      {divider('d1')}
      {btn('h1',        <span style={{fontWeight:800,fontSize:12}}>H1</span>, 'h1', 'Heading 1')}
      {btn('h2',        <span style={{fontWeight:800,fontSize:12}}>H2</span>, 'h2', 'Heading 2')}
      {btn('h3',        <span style={{fontWeight:800,fontSize:12}}>H3</span>, 'h3', 'Heading 3')}
      {divider('d2')}
      {btn('ul',        <List size={13}/>,           'ul',          'Bullet list')}
      {btn('ol',        <ListOrdered size={13}/>,    'ol',          'Numbered list')}
      {btn('todo',      <span style={{fontSize:12}}>☐</span>,       'todo', 'Checklist')}
      {divider('d3')}
      {btn('quote',     <Quote size={13}/>,          'quote',       'Blockquote')}
      {btn('code',      <Code size={13}/>,           'inlinecode',  'Inline code')}
      {btn('codeblock', <span style={{fontFamily:'monospace',fontSize:11}}>{`</>`}</span>, 'codeblock', 'Code block')}
      {divider('d4')}
      {btn('hr',        <Minus size={13}/>,          'hr',          'Divider')}
      {btn('link',      <Link size={13}/>,           'link',        'Insert link')}
      {btn('image',     <span style={{fontSize:12}}>🖼</span>,       'image', 'Insert image')}
    </div>
  );
}

export default function Editor() {
  const { activeNote, view, setView, updateNoteInTree, setActiveNote, activeWorkspace } = useStore(s => ({
    activeNote: s.activeNote, view: s.view, setView: s.setView,
    updateNoteInTree: s.updateNoteInTree, setActiveNote: s.setActiveNote,
    activeWorkspace: s.activeWorkspace
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
      setRichContent(activeNote.note.rich_content || '');
      setEditorMode(activeNote.note.editor_mode || 'markdown');
      try { setTags(JSON.parse(activeNote.note.tags || '[]')); } catch { setTags([]); }
      setLinkSuggestions([]);
    }
  }, [activeNote?.note?.id]);

  const save = useCallback(async (t, c, rc, tg, mode) => {
    if (!activeNote?.note) return;
    setSaving(true);
    try {
      await api.patch(`/notes/${activeNote.note.id}`, { title: t, content: c, rich_content: rc, tags: tg, editor_mode: mode });
      updateNoteInTree(activeNote.note.id, { title: t });
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  }, [activeNote?.note?.id]);

  const schedSave = (t, c, rc, tg, mode) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(t, c, rc, tg, mode), 800);
  };

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

  const handleRichContentChange = (html) => {
    setRichContent(html);
    schedSave(title, content, html, tags, editorMode);
  };

  const fetchLinkSuggestions = async (q) => {
    if (!activeWorkspace) return;
    try {
      const { data } = await api.get(`/notes/workspace/${activeWorkspace.id}/titles?q=${encodeURIComponent(q)}`);
      setLinkSuggestions(data.titles);
    } catch {}
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

  const toggleEditorMode = () => {
    const next = editorMode === 'markdown' ? 'rich' : 'markdown';
    setEditorMode(next);
    schedSave(title, content, richContent, tags, next);
    toast.success(next === 'rich' ? 'Switched to Rich Text' : 'Switched to Markdown', { duration: 1500 });
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

  const handleCanvasChange = useCallback(async (canvasData) => {
    if (!activeNote?.note) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await api.patch(`/notes/${activeNote.note.id}`, { canvas_data: canvasData }); }
      catch { toast.error('Save failed'); }
    }, 800);
  }, [activeNote?.note?.id]);

  if (!activeNote?.note) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 72 }}>🧠</div>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--text-secondary)' }}>Select a note to begin</p>
        <p style={{ fontSize: 13 }}>Or create a new one from the sidebar</p>
      </div>
    );
  }

  const showEditor = view === 'editor' || view === 'split';
  const showPreview = view === 'preview' || view === 'split';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)', height: '100%' }}>

      {/* Top bar - mode toggle + view switcher + save status */}
      {noteType === 'note' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)', borderRadius: 8, padding: 3 }}>
            {[['rich', <Type size={13}/>, 'Rich'], ['markdown', <Code2 size={13}/>, 'Markdown']].map(([mode, icon, label]) => (
              <button key={mode} onClick={() => { if (editorMode !== mode) toggleEditorMode(); }} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: editorMode === mode ? 'var(--accent)' : 'transparent',
                color: editorMode === mode ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s'
              }}>
                {icon}<span>{label}</span>
              </button>
            ))}
          </div>

          {editorMode === 'markdown' && (
            <>
              <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
              <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)', borderRadius: 8, padding: 3 }}>
                {[['editor', <Edit size={13}/>, 'Edit'], ['split', <Columns size={13}/>, 'Split'], ['preview', <Eye size={13}/>, 'Preview']].map(([v, icon, label]) => (
                  <button key={v} onClick={() => setView(v)} title={label} style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                    background: view === v ? 'var(--bg-hover)' : 'transparent',
                    color: view === v ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'all 0.15s'
                  }}>
                    {icon}<span>{label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 60, textAlign: 'right' }}>
            {saving ? '💾 Saving...' : '✓ Saved'}
          </span>
        </div>
      )}

      {/* Markdown formatting toolbar - only in markdown edit/split mode */}
      {noteType === 'note' && editorMode === 'markdown' && (view === 'editor' || view === 'split') && (
        <MarkdownToolbar onFormat={handleMarkdownFormat} />
      )}

      {/* Title + tags - fixed height, never scrolls */}
      <div style={{ padding: '16px 24px 8px', background: 'var(--bg-base)', flexShrink: 0 }}>
        <input
          value={title}
          onChange={handleTitleChange}
          placeholder="Note title..."
          style={{
            width: '100%', background: 'none', border: 'none', outline: 'none',
            fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800,
            color: 'var(--text-primary)', letterSpacing: '-0.02em'
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <Tag size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          {tags.map(tag => (
            <span key={tag} onClick={() => removeTag(tag)} style={{
              padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
              background: 'var(--accent-subtle)', color: 'var(--accent-hover)', cursor: 'pointer',
              border: '1px solid rgba(99,102,241,0.2)', letterSpacing: '0.02em'
            }}>
              #{tag} ×
            </span>
          ))}
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
            placeholder="Add tag..."
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-muted)', fontSize: 12, width: 80 }}
          />
        </div>
      </div>

      {/* Backlinks */}
      {activeNote.links?.length > 0 && (
        <div style={{ padding: '0 24px 8px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          <Link2 size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          {activeNote.links.map(l => (
            <span key={l.id} style={{
              padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 500,
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer'
            }}>
              {l.direction === 'incoming' ? '← ' : '→ '}{l.title}
            </span>
          ))}
        </div>
      )}

      {/* Editor area - MUST fill remaining space */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative' }}>

        {noteType === 'diagram' && (
          <DiagramEditor canvasData={activeNote.note.canvas_data} onChange={handleCanvasChange} />
        )}

        {noteType === 'draw' && (
          <FreeDrawEditor canvasData={activeNote.note.canvas_data} onChange={handleCanvasChange} />
        )}

        {noteType === 'note' && (
          <>
            {editorMode === 'rich' && (
              <RichEditor content={richContent} onChange={handleRichContentChange} editorRef={richEditorRef} />
            )}

            {editorMode === 'markdown' && (
              <>
                {showEditor && (
                  <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
                    <CodeMirror
                      ref={cmRef}
                      value={content}
                      height="100%"
                      theme={oneDark}
                      extensions={[markdown(), listContinuation(handleContentChange)]}
                      onChange={handleContentChange}
                      style={{ height: '100%', fontSize: 14 }}
                      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                    />
                    {linkSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', zIndex: 100, minWidth: 220, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                        <div style={{ padding: '5px 12px', fontSize: 10, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Link to note</div>
                        {linkSuggestions.map(s => (
                          <div key={s.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            onClick={() => { const lastOpen = content.lastIndexOf('[['); handleContentChange(content.slice(0, lastOpen) + `[[${s.title}]]`); setLinkSuggestions([]); }}
                          >📄 {s.title}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {view === 'split' && <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />}
                {showPreview && (
                  <div style={{ flex: 1, minHeight: 0, padding: '16px 24px 48px', overflow: 'auto' }}>
                    <div className="markdown-preview"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                      onClick={e => { const link = e.target.closest('.wiki-link'); if (link) toast(`Navigate to: ${link.dataset.link}`, { icon: '🔗' }); }}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
