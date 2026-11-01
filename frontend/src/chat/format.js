// Message text → safe HTML: **bold**, *italic*, ~~strike~~, `code`, ```code blocks```, links,
// @mentions and [[note links]]. Everything is escaped first, so a message can't inject HTML.

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(text, ctx) {
  const tokens = [];
  const keep = html => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = esc(text);
  // `code` and links first, so nothing inside them is treated as formatting
  s = s.replace(/`([^`\n]+)`/g, (m, c) => keep(`<code>${c}</code>`));
  s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,:;!?)\]'"]/g, url => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = s.replace(/\[\[([^\[\]\n]+)\]\]/g, (m, t) => {
    const [title, alias] = t.split('|').map(x => x.trim());
    return keep(`<span class="chat-notelink" data-note="${title}" role="link" tabindex="0">📄 ${alias || title}</span>`);
  });
  s = s.replace(/(^|[^\w@])@([A-Za-z0-9_.-]{1,40})/g, (m, pre, name) => {
    const lower = name.toLowerCase();
    const isAll = lower === 'everyone' || lower === 'all';
    const user = ctx.usernames?.get(lower);
    if (!user && !isAll) return m;
    const mine = isAll || lower === ctx.me;
    return pre + keep(`<span class="chat-mention${mine ? ' me' : ''}"${user ? ` title="${esc(user)}"` : ''}>@${name}</span>`);
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => tokens[i]);
}

/**
 * ctx: { me: my username (lowercase), usernames: Map(lowercase username → display name) }
 */
export function formatMessage(text, ctx = {}) {
  if (!text) return '';
  const parts = text.split(/```(?:[\w+-]*\n)?([\s\S]*?)```/g);
  return parts.map((p, i) => (i % 2 ? `<pre><code>${esc(p.replace(/\n$/, ''))}</code></pre>` : inline(p, ctx))).join('');
}

/** True for a short message that is only emoji — shown bigger. */
export function emojiOnly(text) {
  const t = (text || '').trim();
  if (!t || t.length > 24) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);
}

export function timeLabel(sec) {
  return new Date(sec * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(sec) {
  const d = new Date(sec * 1000);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

export function shortTime(sec) {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeLabel(sec);
  if (now - d < 6 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fileSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
