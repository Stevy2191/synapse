import { useState, useEffect, useRef, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Eye, Edit, Columns, Link2, Tag, Type, Code2 } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import api from '../../api';
import toast from 'react-hot-toast';
import RichEditor from './RichEditor';
import DiagramEditor from './DiagramEditor';
import FreeDrawEditor from './FreeDrawEditor';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(content) {
  const withLinks = content.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link" data-link="$1">$1</span>');
  return DOMPurify.sanitize(marked.parse(withLinks), { ADD_ATTR: ['data-link'] });
}

export default function Editor() {
  const { activeNote, view, setView, updateNoteInTree, setActiveNote, activeWorkspace } = useStore(s => ({
    activeNote: s.activeNote, view: s.view, setView: s.setView,
    updateNoteInTree: s.updateNoteInTree, setActiveNote: s.setActiveNote,
    activeWorkspace: s.activeWorkspace
  }));

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [editorMode, setEditorMode] = useState('markdown');
  const [linkSuggestions, setLinkSuggestions] = useState([]);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(null);
  const richEditorRef = useRef(null);

  useEffect(() => {
    if (activeNote?.note) {
      setTitle(activeNote.note.title);
      setContent(activeNote.note.content || '');
      setEditorMode(activeNote.note.editor_mode || 'markdown');
      try { setTags(JSON.parse(activeNote.note.tags || '[]')); } catch { setTags([]); }
      setLinkSuggestions([]);
    }
  }, [activeNote?.note?.id]);

  const save = useCallback(async (t, c, tg, mode) => {
    if (!activeNote?.note) return;
    setSaving(true);
    try {
      await api.patch(`/notes/${activeNote.note.id}`, { title: t, content: c, tags: tg, editor_mode: mode });
      updateNoteInTree(activeNote.note.id, { title: t });
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  }, [activeNote?.note?.id]);

  const schedSave = (t, c, tg, mode) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(t, c, tg, mode), 800);
  };

  const handleTitleChange = (e) => {
    setTitle(e.target.value);
    schedSave(e.target.value, content, tags, editorMode);
  };

  const handleContentChange = (val) => {
    setContent(val);
    schedSave(title, val, tags, editorMode);
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
      schedSave(title, content, next, editorMode);
    }
    setTagInput('');
  };

  const removeTag = (tag) => {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    schedSave(title, content, next, editorMode);
  };

  const toggleEditorMode = () => {
    const next = editorMode === 'markdown' ? 'rich' : 'markdown';
    setEditorMode(next);
    schedSave(title, content, tags, next);
    toast.success(next === 'rich' ? 'Switched to Rich Text' : 'Switched to Markdown', { duration: 1500 });
  };

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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Toolbar - only for regular notes */}
      {noteType === 'note' && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>

        {/* Editor mode toggle */}
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

      {/* Title */}
      <div style={{ padding: '20px 24px 8px', background: 'var(--bg-base)', flexShrink: 0 }}>
        <input
          value={title}
          onChange={handleTitleChange}
          placeholder="Note title..."
          style={{
            width: '100%', background: 'none', border: 'none', outline: 'none',
            fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800,
            color: 'var(--text-primary)', letterSpacing: '-0.02em'
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
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

      {/* Editor area - routed by note type */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {noteType === 'diagram' && (
          <DiagramEditor
            canvasData={activeNote.note.canvas_data}
            onChange={handleCanvasChange}
          />
        )}

        {noteType === 'draw' && (
          <FreeDrawEditor
            canvasData={activeNote.note.canvas_data}
            onChange={handleCanvasChange}
          />
        )}

        {noteType === 'note' && (
          <>
            {editorMode === 'rich' && (
              <RichEditor content={content} onChange={handleContentChange} editorRef={richEditorRef} />
            )}
            {editorMode === 'markdown' && (
              <>
                {showEditor && (
                  <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    <CodeMirror
                      value={content} height="100%" theme={oneDark} extensions={[markdown()]}
                      onChange={handleContentChange} style={{ height: '100%', fontSize: 14 }}
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
                  <div style={{ flex: 1, padding: '16px 24px 48px', overflow: 'auto' }}>
                    <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
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
