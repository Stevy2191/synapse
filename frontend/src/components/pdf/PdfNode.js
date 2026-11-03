// A PDF inside a note, with pen markings on top.
//
// Stored in the note's HTML as
//   <div data-pdf="<attachment id>" data-name="Report.pdf" data-pages="12" data-ink='{"1":[…]}'></div>
// and in the Markdown copy as a fenced block (convert.js):
//   ```synapse-pdf
//   {"id":"…","name":"Report.pdf","pages":12,"ink":{…}}
//   ```
// The file is an attachment (pdf/files.js); the markings are part of the note, so they sync, work
// offline, show up live for others and are kept in the note's history.
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import PdfBlockView from './PdfBlockView';

export const PdfNode = Node.create({
  name: 'pdf',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null },
      name: { default: 'Document.pdf' },
      pages: { default: 0 },
      ink: { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-pdf]',
      getAttrs: el => ({
        id: el.getAttribute('data-pdf') || null,
        name: el.getAttribute('data-name') || 'Document.pdf',
        pages: Number(el.getAttribute('data-pages')) || 0,
        ink: el.getAttribute('data-ink') || '',
      }),
    }];
  },

  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-pdf': node.attrs.id || '',
      'data-name': node.attrs.name,
      'data-pages': String(node.attrs.pages || 0),
      ...(node.attrs.ink ? { 'data-ink': node.attrs.ink } : {}),
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PdfBlockView);
  },
});

/** Pick a PDF on this device and insert it as a block at the cursor. */
export function pickPdf(editor, noteId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.onchange = () => { const f = input.files?.[0]; if (f) insertPdf(editor, f, noteId); };
  input.click();
}

export async function insertPdf(editor, file, noteId, pos) {
  const toast = (await import('react-hot-toast')).default;
  if (!noteId) { toast.error('Open a note first'); return; }
  const t = toast.loading(`Adding “${file.name}”…`);
  try {
    const { addPdf } = await import('../../pdf/files');
    const attrs = await addPdf(file, noteId);
    const content = [{ type: 'pdf', attrs }, { type: 'paragraph' }];
    const chain = editor.chain().focus();
    (pos != null ? chain.insertContentAt(pos, content) : chain.insertContent(content)).run();
    toast.success(navigator.onLine ? 'PDF added' : 'PDF added — it uploads when you’re back online', { id: t });
  } catch (err) {
    toast.error(err.message || 'Couldn’t add that PDF', { id: t });
  }
}
