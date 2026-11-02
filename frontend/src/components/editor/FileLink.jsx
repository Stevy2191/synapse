// A file in a note: a small chip ("📎 Budget.xlsx · 18 KB") that opens the file when clicked.
//   kind "copy" → a copy kept in Synapse (an attachment)         href /open-file?att=…
//   kind "link" → the original in a network folder or cloud drive  href /open-file?src=… or the drive's own web link
// Markdown: [📎 Name](href) — any link whose text starts with 📎 becomes a chip again.
import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const sizeText = n => (!n ? '' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

export const FileLink = Node.create({
  name: 'fileLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: '' },
      name: { default: 'File' },
      size: { default: null, parseHTML: el => Number(el.getAttribute('data-size')) || null },
      kind: { default: 'link', parseHTML: el => (el.getAttribute('data-file') === 'copy' ? 'copy' : 'link') },
    };
  },
  parseHTML() {
    return [{
      tag: 'a[data-file]',
      priority: 1000, // before the ordinary link mark
      getAttrs: el => ({
        href: el.getAttribute('href') || '',
        name: el.getAttribute('data-name') || el.textContent.replace(/^📎\s*/, '').replace(/\s·\s[\d.]+\s(B|KB|MB|GB)$/, '').trim() || 'File',
      }),
    }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { href, name, size, kind } = node.attrs;
    return ['a', mergeAttributes(HTMLAttributes, {
      href, 'data-file': kind, 'data-name': name, ...(size ? { 'data-size': size } : {}),
      class: `file-chip${kind === 'copy' ? ' copy' : ''}`, target: '_blank', rel: 'noopener noreferrer',
      title: kind === 'copy' ? `${name} — a copy saved in Synapse. Click to open.` : `${name} — opens the original. Click to open.`,
    }), `📎 ${name}${size ? ` · ${sizeText(size)}` : ''}`];
  },
  renderText: ({ node }) => `📎 ${node.attrs.name}`,
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('fileLinkClick'),
      props: {
        // Open the file on click (links in the editor don't open by themselves).
        handleClickOn(view, pos, node, nodePos, event) {
          if (node.type.name !== 'fileLink' || !node.attrs.href) return false;
          event.preventDefault();
          window.open(node.attrs.href, '_blank', 'noopener');
          return true;
        },
      },
    })];
  },
});
