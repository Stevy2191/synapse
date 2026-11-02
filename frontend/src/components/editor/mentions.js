// "@" in a note of a shared workspace: pick someone in the workspace → "@username". When the note is
// saved, the server notifies them (backend/src/mentions.js).
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { useStore } from '../../stores/useStore';
import { membersNow, personLabel } from '../../team/team';
import { renderer, notInCode } from './extensions';

function people(query) {
  const { activeWorkspace, user } = useStore.getState();
  const q = query.trim().toLowerCase();
  return membersNow(activeWorkspace?.id)
    .filter(p => p.id !== user?.id && (p.username.toLowerCase().includes(q) || personLabel(p).toLowerCase().includes(q)))
    .slice(0, 8)
    .map(p => ({ id: p.id, title: personLabel(p), desc: `@${p.username}`, username: p.username }));
}

export const MentionSuggest = Extension.create({
  name: 'mentionSuggest',
  priority: 2000,
  addOptions() { return { getUi: () => ({}) }; },
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('mentionSuggest'),
      char: '@',
      allow: notInCode,
      items: ({ query }) => people(query),
      command: ({ editor, range, props }) => editor.chain().focus().insertContentAt(range, `@${props.username} `).run(),
      render: renderer('mention', this.options.getUi),
    })];
  },
});
