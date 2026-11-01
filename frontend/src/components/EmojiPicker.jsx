// A small emoji picker for workspace icons: categories, search, and a button that opens it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

// [emoji, search words]
const CATEGORIES = [
  ['Popular', [
    ['🧠', 'brain mind think'], ['📁', 'folder files'], ['🏠', 'home house'], ['💼', 'work briefcase job business'],
    ['📚', 'books library study'], ['📝', 'note memo write'], ['💡', 'idea light bulb'], ['🚀', 'rocket launch project'],
    ['⭐', 'star favourite'], ['❤️', 'heart love'], ['🔥', 'fire hot'], ['✨', 'sparkles magic'],
    ['🎯', 'target goal'], ['📌', 'pin'], ['🗂️', 'dividers index'], ['🧪', 'lab test experiment'],
  ]],
  ['Work & study', [
    ['📊', 'chart bar stats'], ['📈', 'chart up growth'], ['📉', 'chart down'], ['🗓️', 'calendar plan'], ['📅', 'calendar date'],
    ['⏰', 'alarm clock time'], ['📋', 'clipboard'], ['📎', 'paperclip'], ['✏️', 'pencil'], ['🖊️', 'pen'], ['📓', 'notebook'],
    ['📔', 'notebook'], ['📒', 'ledger'], ['📖', 'book open read'], ['🎓', 'graduation school university'], ['🏫', 'school'],
    ['🧾', 'receipt'], ['💰', 'money bag finance'], ['💳', 'card payment'], ['🏦', 'bank'], ['🧮', 'abacus maths'],
    ['🔬', 'microscope science'], ['🔭', 'telescope astronomy'], ['⚖️', 'law scales'], ['🏛️', 'government building'],
    ['📣', 'megaphone marketing'], ['🤝', 'handshake meeting deal'], ['🗳️', 'vote'], ['📦', 'package box'], ['🏷️', 'label tag'],
  ]],
  ['Tech', [
    ['💻', 'laptop computer code'], ['🖥️', 'desktop computer'], ['⌨️', 'keyboard'], ['🖱️', 'mouse'], ['📱', 'phone mobile'],
    ['🔌', 'plug'], ['🔋', 'battery'], ['🛠️', 'tools build'], ['🔧', 'wrench fix'], ['⚙️', 'gear settings'], ['🧰', 'toolbox'],
    ['🔒', 'lock security'], ['🔑', 'key'], ['🛡️', 'shield security'], ['🌐', 'globe web internet'], ['📡', 'satellite antenna'],
    ['🤖', 'robot ai bot'], ['👾', 'game alien'], ['🎮', 'game controller'], ['🧩', 'puzzle'], ['🗄️', 'cabinet archive'],
    ['💾', 'disk save'], ['🖨️', 'printer'], ['🧬', 'dna biology'], ['⚡', 'lightning fast power'], ['🐧', 'linux penguin'],
    ['🐳', 'docker whale'], ['☁️', 'cloud'], ['🛰️', 'satellite'], ['📶', 'signal wifi'],
  ]],
  ['Home & life', [
    ['🏡', 'house garden home'], ['🛋️', 'couch living'], ['🛏️', 'bed sleep'], ['🍳', 'cooking kitchen'], ['🍽️', 'dinner food'],
    ['🛒', 'shopping cart groceries'], ['🧺', 'laundry basket'], ['🧹', 'cleaning broom chores'], ['🪴', 'plant'], ['🌱', 'seedling grow garden'],
    ['🐶', 'dog pet'], ['🐱', 'cat pet'], ['👶', 'baby'], ['👨‍👩‍👧', 'family'], ['🎁', 'gift present'], ['🎉', 'party celebrate'],
    ['🎂', 'birthday cake'], ['💊', 'pill health medicine'], ['🏥', 'hospital health'], ['🧘', 'yoga meditation wellbeing'],
    ['🏃', 'running exercise'], ['🏋️', 'gym weights fitness'], ['🚗', 'car'], ['✈️', 'plane travel flight'], ['🧳', 'luggage travel trip'],
    ['🗺️', 'map travel'], ['🏖️', 'beach holiday'], ['⛺', 'camping tent'], ['🏔️', 'mountain'], ['🔨', 'hammer diy repair'],
  ]],
  ['Food', [
    ['🍎', 'apple'], ['🍌', 'banana'], ['🍓', 'strawberry'], ['🥑', 'avocado'], ['🥕', 'carrot'], ['🍞', 'bread'],
    ['🧀', 'cheese'], ['🍕', 'pizza'], ['🍔', 'burger'], ['🌮', 'taco'], ['🍜', 'noodles ramen'], ['🍣', 'sushi'],
    ['🍰', 'cake'], ['🍪', 'cookie'], ['☕', 'coffee'], ['🍵', 'tea'], ['🍷', 'wine'], ['🍺', 'beer'],
  ]],
  ['Hobbies', [
    ['🎨', 'art paint palette'], ['🎵', 'music note'], ['🎸', 'guitar music'], ['🎹', 'piano music'], ['🎧', 'headphones music'],
    ['📷', 'camera photo'], ['🎬', 'film movie'], ['📺', 'tv'], ['🎭', 'theatre drama'], ['✍️', 'writing'], ['🧶', 'knitting yarn'],
    ['🪡', 'sewing'], ['⚽', 'football soccer'], ['🏀', 'basketball'], ['🎾', 'tennis'], ['⛳', 'golf'], ['🎣', 'fishing'],
    ['🚴', 'cycling bike'], ['♟️', 'chess'], ['🎲', 'dice game'], ['🃏', 'cards'], ['🧗', 'climbing'], ['🏕️', 'camping'], ['🔭', 'stars'],
  ]],
  ['Nature', [
    ['🌍', 'earth world'], ['🌙', 'moon night'], ['☀️', 'sun'], ['⛅', 'cloud weather'], ['🌈', 'rainbow'], ['❄️', 'snow winter'],
    ['🌊', 'wave ocean sea'], ['🌲', 'tree forest'], ['🌸', 'blossom flower'], ['🌻', 'sunflower'], ['🍀', 'clover luck'], ['🍁', 'leaf autumn'],
    ['🦋', 'butterfly'], ['🐝', 'bee'], ['🦊', 'fox'], ['🦉', 'owl wise'], ['🐢', 'turtle'], ['🐙', 'octopus'],
  ]],
  ['Symbols', [
    ['✅', 'check done'], ['☑️', 'checkbox'], ['❗', 'important'], ['❓', 'question'], ['⚠️', 'warning'], ['🔴', 'red circle'],
    ['🟠', 'orange circle'], ['🟡', 'yellow circle'], ['🟢', 'green circle'], ['🔵', 'blue circle'], ['🟣', 'purple circle'], ['⚫', 'black circle'],
    ['🟥', 'red square'], ['🟩', 'green square'], ['🟦', 'blue square'], ['🔶', 'diamond orange'], ['💎', 'gem diamond'], ['♾️', 'infinity'],
    ['🔗', 'link'], ['🧭', 'compass'], ['🗝️', 'old key'], ['🔖', 'bookmark'], ['📍', 'location pin'], ['🏁', 'finish flag'],
    ['🚩', 'flag'], ['💬', 'chat speech'], ['💭', 'thought'], ['👁️', 'eye'], ['🧿', 'nazar'], ['☯️', 'yin yang'],
  ]],
];

// Extra categories shown first in chat (reactions and messages).
const CHAT_CATEGORIES = [
  ['Smileys', [
    ['😀', 'grin smile happy'], ['😃', 'smile happy'], ['😄', 'smile laugh'], ['😁', 'grin beam'], ['😆', 'laugh'], ['😅', 'sweat smile phew'],
    ['🤣', 'rofl laugh rolling'], ['😂', 'joy laugh tears lol'], ['🙂', 'slight smile'], ['🙃', 'upside down'], ['😉', 'wink'], ['😊', 'blush smile'],
    ['😇', 'angel innocent'], ['🥰', 'love hearts'], ['😍', 'heart eyes love'], ['🤩', 'star struck wow'], ['😘', 'kiss'], ['😋', 'yum tasty'],
    ['😛', 'tongue'], ['😜', 'wink tongue crazy'], ['🤪', 'zany crazy'], ['🤗', 'hug'], ['🤭', 'oops giggle'], ['🤫', 'shush quiet'],
    ['🤔', 'think hmm'], ['🤐', 'zip mouth'], ['😐', 'neutral'], ['😑', 'expressionless'], ['😶', 'no mouth'], ['😏', 'smirk'],
    ['😒', 'unamused'], ['🙄', 'eye roll'], ['😬', 'grimace awkward'], ['😌', 'relieved'], ['😔', 'pensive sad'], ['😪', 'sleepy'],
    ['😴', 'sleep zzz'], ['😷', 'mask sick'], ['🤒', 'thermometer sick'], ['🤢', 'nauseated sick'], ['🥵', 'hot'], ['🥶', 'cold freezing'],
    ['🥴', 'woozy'], ['🤯', 'mind blown exploding'], ['🤠', 'cowboy'], ['🥳', 'party celebrate'], ['😎', 'cool sunglasses'], ['🤓', 'nerd'],
    ['😕', 'confused'], ['😟', 'worried'], ['🙁', 'frown'], ['😮', 'wow surprised open mouth'], ['😲', 'astonished'], ['😳', 'flushed embarrassed'],
    ['🥺', 'pleading puppy'], ['😢', 'cry sad tear'], ['😭', 'sob cry'], ['😱', 'scream fear'], ['😤', 'huff triumph'], ['😡', 'angry mad'],
    ['🤬', 'swear cursing'], ['💀', 'skull dead'], ['💩', 'poop'], ['🤡', 'clown'], ['👻', 'ghost'], ['👽', 'alien'],
  ]],
  ['People & hands', [
    ['👍', 'thumbs up yes like ok'], ['👎', 'thumbs down no dislike'], ['👏', 'clap applause'], ['🙌', 'raise hands hooray'], ['🙏', 'pray thanks please'], ['🤝', 'handshake deal'],
    ['👋', 'wave hello bye'], ['✌️', 'peace victory'], ['🤞', 'fingers crossed luck'], ['🤟', 'love you'], ['🤘', 'rock'], ['👌', 'ok perfect'],
    ['🤌', 'pinched'], ['👈', 'left point'], ['👉', 'right point'], ['👆', 'up point'], ['👇', 'down point'], ['☝️', 'index up'],
    ['✋', 'raised hand stop'], ['💪', 'muscle strong flex'], ['🫶', 'heart hands'], ['🤷', 'shrug dunno'], ['🤦', 'facepalm'], ['🙋', 'raising hand me'],
    ['🙆', 'ok gesture'], ['🙅', 'no gesture'], ['💁', 'tipping hand'], ['🧑‍💻', 'coder developer'], ['👨‍👩‍👧', 'family'], ['👶', 'baby'],
  ]],
  ['Hearts & celebration', [
    ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
    ['🖤', 'black heart'], ['🤍', 'white heart'], ['💔', 'broken heart'], ['💕', 'two hearts'], ['💖', 'sparkling heart'], ['💯', 'hundred 100'],
    ['🎉', 'party tada celebrate'], ['🎊', 'confetti'], ['🎂', 'birthday cake'], ['🎁', 'gift present'], ['🎈', 'balloon'], ['🥂', 'cheers toast'],
    ['🍾', 'champagne'], ['🏆', 'trophy win'], ['🥇', 'gold medal first'], ['👑', 'crown king queen'], ['💤', 'zzz sleep'], ['👀', 'eyes look'],
  ]],
  ['Travel', [
    ['✈️', 'plane flight travel vacation'], ['🏖️', 'beach vacation holiday'], ['🏝️', 'island'], ['⛱️', 'umbrella beach'], ['🏔️', 'mountain snow'], ['⛺', 'tent camping'],
    ['🚗', 'car drive'], ['🚆', 'train'], ['🚢', 'ship cruise'], ['🗺️', 'map'], ['🧳', 'luggage suitcase'], ['🎢', 'roller coaster theme park'],
    ['🌍', 'earth world'], ['🗽', 'statue liberty'], ['🗼', 'tower'], ['🏰', 'castle'], ['🌅', 'sunrise'], ['🌴', 'palm tree'],
  ]],
];

const ALL = [...CHAT_CATEGORIES, ...CATEGORIES].flatMap(([, items]) => items);

export default function EmojiPicker({ onPick, onClose, anchorStyle, forChat = false }) {
  const cats = forChat ? [...CHAT_CATEGORIES, ...CATEGORIES] : CATEGORIES;
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const close = e => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc, true); };
  }, [onClose]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return null;
    const seen = new Set();
    return ALL.filter(([e, words]) => words.includes(term) && !seen.has(e) && seen.add(e));
  }, [q]);

  const grid = items => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2 }}>
      {items.map(([e, words]) => (
        <button key={e + words} title={words.split(' ')[0]} onClick={() => onPick(e)} className="emoji-cell">{e}</button>
      ))}
    </div>
  );

  return (
    <div ref={ref} className="emoji-picker fade-in" style={anchorStyle} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', marginBottom: 8 }}>
        <Search size={14} style={{ color: 'var(--text-muted)' }} />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={forChat ? "Search (e.g. laugh, heart, party)" : "Search (e.g. work, book, home)"}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', font: '400 13px var(--font-sans)' }} />
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
        {results ? (
          results.length ? grid(results) : <p style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>No match. Try another word.</p>
        ) : cats.map(([name, items]) => (
          <div key={name} style={{ marginBottom: 8 }}>
            <div className="section-label" style={{ padding: '4px 2px' }}>{name}</div>
            {grid(items)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A button showing the current emoji; clicking opens the picker. */
export function EmojiButton({ value, onChange, size = 40, align = 'left' }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen(o => !o)} title="Choose an emoji" className="emoji-button"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}>
        {value || '📁'}
      </button>
      {open && (
        <EmojiPicker
          onPick={e => { onChange(e); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorStyle={{ position: 'absolute', top: size + 6, [align]: 0, zIndex: 300 }}
        />
      )}
    </span>
  );
}
