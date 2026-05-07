import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import SlashMenu from './SlashMenu';
import FloatingToolbar from './FloatingToolbar';
import TurndownService from 'turndown';
import { marked } from 'marked';

const lowlight = createLowlight();
lowlight.register({ javascript, python, bash });

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
td.addRule('taskItem', {
  filter: node => node.nodeName === 'LI' && node.getAttribute('data-checked') !== null,
  replacement: (content, node) => {
    const checked = node.getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
  }
});

// Convert markdown to HTML for TipTap initial load
function mdToHtml(md) {
  if (!md) return '';
  return marked.parse(md);
}

// Convert TipTap HTML back to markdown for storage
function htmlToMd(html) {
  if (!html || html === '<p></p>') return '';
  return td.turndown(html);
}

export default function RichEditor({ content, onChange, editorRef: editorRefProp }) {
  const [slashMenu, setSlashMenu] = useState(null); // { query, position }
  const slashStart = useRef(null);
  const containerRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Placeholder.configure({ placeholder: "Type '/' for commands, or just start writing…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Image.configure({ inline: false }),
      Typography,
    ],
    content: mdToHtml(content),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const md = htmlToMd(html);
      onChange(md);
    },
    editorProps: {
      attributes: { class: 'rich-editor-content', spellcheck: 'true' },
      handleKeyDown: (view, event) => {
        // Open slash menu on '/'
        if (event.key === '/' && !slashMenu) {
          const { from } = view.state.selection;
          const coords = view.coordsAtPos(from);
          slashStart.current = from;
          setSlashMenu({ query: '', position: { x: coords.left, y: coords.bottom } });
          return false;
        }
        return false;
      },
    },
  });

  // Track slash query as user types after '/'
  useEffect(() => {
    if (!editor || !slashMenu) return;
    const handler = ({ editor: e }) => {
      if (slashStart.current == null) return;
      const { from } = e.state.selection;
      if (from < slashStart.current) { setSlashMenu(null); slashStart.current = null; return; }
      const text = e.state.doc.textBetween(slashStart.current, from);
      if (text.includes(' ') || text.includes('\n')) { setSlashMenu(null); slashStart.current = null; return; }
      const coords = e.view.coordsAtPos(slashStart.current);
      setSlashMenu({ query: text, position: { x: coords.left, y: coords.bottom } });
    };
    editor.on('selectionUpdate', handler);
    editor.on('update', handler);
    return () => { editor.off('selectionUpdate', handler); editor.off('update', handler); };
  }, [editor, slashMenu]);

  // Expose editor to parent
  useEffect(() => {
    if (editorRefProp) editorRefProp.current = editor;
  }, [editor, editorRefProp]);

  // Update content when note changes
  useEffect(() => {
    if (!editor) return;
    const currentMd = htmlToMd(editor.getHTML());
    if (currentMd !== content) {
      editor.commands.setContent(mdToHtml(content), false);
    }
  }, [content]);

  const handleSlashSelect = useCallback((cmdId) => {
    if (!editor || slashStart.current == null) return;
    setSlashMenu(null);

    // Delete the '/' and any query text typed
    const { from } = editor.state.selection;
    editor.chain().focus()
      .deleteRange({ from: slashStart.current - 1, to: from })
      .run();

    slashStart.current = null;

    // Insert the selected block
    const chain = editor.chain().focus();
    switch (cmdId) {
      case 'h1':       chain.toggleHeading({ level: 1 }).run(); break;
      case 'h2':       chain.toggleHeading({ level: 2 }).run(); break;
      case 'h3':       chain.toggleHeading({ level: 3 }).run(); break;
      case 'bullet':   chain.toggleBulletList().run(); break;
      case 'numbered': chain.toggleOrderedList().run(); break;
      case 'todo':     chain.toggleTaskList().run(); break;
      case 'quote':    chain.toggleBlockquote().run(); break;
      case 'code':     chain.toggleCodeBlock().run(); break;
      case 'divider':  chain.setHorizontalRule().run(); break;
      case 'image': {
        const url = prompt('Image URL:');
        if (url) chain.setImage({ src: url }).run();
        break;
      }
    }
  }, [editor]);

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
      <style>{`
        .rich-editor-content {
          outline: none;
          padding: 16px 24px 64px;
          min-height: 100%;
          font-family: var(--font-sans);
          font-size: 15px;
          line-height: 1.8;
          color: var(--text-primary);
        }
        .rich-editor-content h1 { font-family: var(--font-display); font-size: 2em; font-weight: 800; margin: 1em 0 0.4em; letter-spacing: -0.02em; }
        .rich-editor-content h2 { font-family: var(--font-display); font-size: 1.5em; font-weight: 700; margin: 0.9em 0 0.3em; }
        .rich-editor-content h3 { font-size: 1.2em; font-weight: 600; margin: 0.8em 0 0.3em; }
        .rich-editor-content p { margin: 0.4em 0; }
        .rich-editor-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--text-muted);
          float: left;
          height: 0;
          pointer-events: none;
        }
        .rich-editor-content ul, .rich-editor-content ol { padding-left: 1.5em; margin: 0.4em 0; }
        .rich-editor-content li { margin: 0.2em 0; }
        .rich-editor-content ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
        .rich-editor-content ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 8px; }
        .rich-editor-content ul[data-type="taskList"] li input[type="checkbox"] { margin-top: 4px; accent-color: var(--accent); cursor: pointer; width: 15px; height: 15px; }
        .rich-editor-content ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: var(--text-muted); }
        .rich-editor-content blockquote { border-left: 3px solid var(--accent); padding-left: 1em; color: var(--text-secondary); margin: 0.8em 0; }
        .rich-editor-content code { background: var(--bg-elevated); color: var(--accent-hover); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.88em; }
        .rich-editor-content pre { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 16px; overflow-x: auto; margin: 1em 0; }
        .rich-editor-content pre code { background: none; padding: 0; color: var(--text-primary); }
        .rich-editor-content hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
        .rich-editor-content img { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }
        .rich-editor-content a { color: var(--accent); text-decoration: none; }
        .rich-editor-content a:hover { text-decoration: underline; }
        .rich-editor-content strong { font-weight: 700; }
        .rich-editor-content em { font-style: italic; }
        .ProseMirror-selectednode { outline: 2px solid var(--accent); border-radius: 4px; }
        /* Highlight.js in code blocks */
        .hljs-keyword, .hljs-selector-tag { color: #ff79c6; }
        .hljs-string, .hljs-attr { color: #f1fa8c; }
        .hljs-comment { color: #6272a4; }
        .hljs-number { color: #bd93f9; }
        .hljs-built_in, .hljs-name { color: #8be9fd; }
        .hljs-function { color: #50fa7b; }
      `}</style>

      <EditorContent editor={editor} />
      <FloatingToolbar editor={editor} />

      {slashMenu && (
        <SlashMenu
          query={slashMenu.query}
          position={slashMenu.position}
          onSelect={handleSlashSelect}
          onClose={() => { setSlashMenu(null); slashStart.current = null; }}
        />
      )}
    </div>
  );
}
