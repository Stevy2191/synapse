// A diagram block inside a note: a draw.io diagram or an Excalidraw drawing.
//
// Stored in the note's HTML as
//   <figure data-diagram="drawio|excalidraw" data-scene="…"><img src="data:image/svg+xml…"></figure>
//   drawio:     the picture is an SVG with the editable diagram embedded (draw.io's own "xmlsvg"
//               format), so data-scene is empty.
//   excalidraw: data-scene holds the drawing (Excalidraw JSON); the picture is for display.
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import DiagramBlockView from './DiagramBlockView';

export const DiagramNode = Node.create({
  name: 'diagram',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'drawio' },
      scene: { default: null },
      preview: { default: null },
    };
  },

  parseHTML() {
    return [{
      tag: 'figure[data-diagram]',
      getAttrs: el => ({
        kind: el.getAttribute('data-diagram') === 'excalidraw' ? 'excalidraw' : 'drawio',
        scene: el.getAttribute('data-scene') || null,
        preview: el.querySelector('img')?.getAttribute('src') || null,
      }),
    }];
  },

  renderHTML({ node }) {
    return ['figure', mergeAttributes({ 'data-diagram': node.attrs.kind, 'data-scene': node.attrs.scene || '' }),
      ['img', { src: node.attrs.preview || '', alt: node.attrs.kind === 'excalidraw' ? 'Excalidraw drawing' : 'draw.io diagram' }]];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DiagramBlockView);
  },
});
