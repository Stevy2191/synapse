import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
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
import RichToolbar from './RichToolbar';

const lowlight = createLowlight();
lowlight.register({ javascript, python, bash });

// Rich editor stores HTML directly - no markdown conversion
// content prop is HTML when in rich mode
export default function RichEditor({ content, onChange, editorRef: editorRefProp }) {
  const lastHtmlRef = useRef(content);
  const isFirstLoad = useRef(true);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Placeholder.configure({ placeholder: 'Start typing… use the toolbar above for formatting' }),
      TaskList,
      TaskItem.configure({ nested: false }),
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
    ],
    content: content || '<p></p>',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastHtmlRef.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (editorRefProp) editorRefProp.current = editor;
  }, [editor, editorRefProp]);

  // Only reload when switching to a different note
  useEffect(() => {
    if (!editor) return;
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    if (content !== lastHtmlRef.current) {
      lastHtmlRef.current = content;
      editor.commands.setContent(content || '<p></p>', false);
    }
  }, [content]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <RichToolbar editor={editor} />
      <div style={{ flex: 1, overflow: 'auto' }} onClick={() => editor?.commands.focus()}>
        <style>{`
          .rich-editor-content {
            outline: none;
            padding: 20px 32px 64px;
            min-height: 100%;
            font-family: var(--font-sans);
            font-size: 15px;
            line-height: 1.8;
            color: var(--text-primary);
            cursor: text;
          }
          .rich-editor-content h1 { font-family: var(--font-display); font-size: 2em; font-weight: 800; margin: 1em 0 0.4em; letter-spacing: -0.02em; }
          .rich-editor-content h2 { font-family: var(--font-display); font-size: 1.5em; font-weight: 700; margin: 0.9em 0 0.3em; }
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
          .rich-editor-content ul[data-type="taskList"] > li[data-type="taskItem"] {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            gap: 10px;
            margin: 0.4em 0;
            padding: 2px 0;
          }
          .rich-editor-content ul[data-type="taskList"] > li[data-type="taskItem"] > label {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            padding-top: 3px;
            cursor: pointer;
          }
          .rich-editor-content ul[data-type="taskList"] > li[data-type="taskItem"] > label > input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: var(--accent);
            cursor: pointer;
            margin: 0;
            flex-shrink: 0;
          }
          .rich-editor-content ul[data-type="taskList"] > li[data-type="taskItem"] > div {
            flex: 1;
            min-width: 0;
            cursor: text;
          }
          .rich-editor-content ul[data-type="taskList"] > li[data-type="taskItem"] > div > p {
            margin: 0;
            min-height: 1.6em;
          }
          .rich-editor-content ul[data-type="taskList"] > li[data-type="taskItem"][data-checked="true"] > div > p {
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
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
