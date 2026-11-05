// Every theme sets the same CSS variables; components only ever use the variables.
// Optional extras (--bg-sidebar, --heading, --glow) fall back to sensible values in applyTheme.
export const THEMES = {
  auto: {
    label: 'Auto',
    icon: '◐',
    description: 'Neural, light or dark to match your device',
    vars: {}, // resolved at runtime to neural / neural-light
  },
  neural: {
    label: 'Neural',
    icon: '✦',
    vars: {
      '--bg-base': '#0b0d1a',
      '--bg-surface': '#0e1122',
      '--bg-sidebar': 'linear-gradient(180deg, #0f1226 0%, #0b0d1a 100%)',
      '--bg-elevated': '#141834',
      '--bg-hover': '#1a1f42',
      '--border': '#1f2547',
      '--border-subtle': '#171c38',
      '--text-primary': '#e6e8ff',
      '--text-secondary': '#a9aedb',
      '--text-muted': '#6a70a0',
      '--accent': '#7c7bff',
      '--accent-hover': '#a3a2ff',
      '--accent-subtle': 'rgba(124,123,255,0.14)',
      '--success': '#34d399',
      '--warning': '#fbbf24',
      '--danger': '#f87171',
      '--scrollbar': '#262c55',
      '--heading': 'linear-gradient(90deg, #ffffff 0%, #b9b8ff 100%)',
      '--glow': '0 0 10px rgba(124,123,255,0.55)',
      '--shadow': '0 24px 60px rgba(3,4,20,0.6)',
    }
  },
  'neural-light': {
    label: 'Neural Light',
    icon: '✧',
    vars: {
      '--bg-base': '#fbfbff',
      '--bg-surface': '#ffffff',
      '--bg-sidebar': 'linear-gradient(180deg, #f5f5ff 0%, #f0f1fb 100%)',
      '--bg-elevated': '#f1f2fb',
      '--bg-hover': '#e9eafa',
      '--border': '#e2e4f3',
      '--border-subtle': '#eceefa',
      '--text-primary': '#16183a',
      '--text-secondary': '#4d5280',
      '--text-muted': '#8a8fb5',
      '--accent': '#5b5ae8',
      '--accent-hover': '#4746d4',
      '--accent-subtle': 'rgba(91,90,232,0.10)',
      '--success': '#059669',
      '--warning': '#d97706',
      '--danger': '#dc2626',
      '--scrollbar': '#d6d8ee',
      '--heading': 'linear-gradient(90deg, #16183a 0%, #5b5ae8 100%)',
      '--glow': '0 0 8px rgba(91,90,232,0.35)',
      '--shadow': '0 24px 60px rgba(40,42,100,0.16)',
    }
  },
  dark: {
    label: 'Dark',
    icon: '🌙',
    vars: {
      '--bg-base': '#0f0f13',
      '--bg-surface': '#16161f',
      '--bg-elevated': '#1e1e2a',
      '--bg-hover': '#252533',
      '--border': '#2a2a3a',
      '--border-subtle': '#1f1f2e',
      '--text-primary': '#e8e8f0',
      '--text-secondary': '#8888a8',
      '--text-muted': '#55556a',
      '--accent': '#6366f1',
      '--accent-hover': '#818cf8',
      '--accent-subtle': '#6366f120',
      '--success': '#22c55e',
      '--warning': '#f59e0b',
      '--danger': '#ef4444',
      '--scrollbar': '#2a2a3a',
    }
  },
  light: {
    label: 'Light',
    icon: '☀️',
    vars: {
      '--bg-base': '#f5f5fa',
      '--bg-surface': '#ffffff',
      '--bg-elevated': '#f0f0f8',
      '--bg-hover': '#e8e8f4',
      '--border': '#d8d8e8',
      '--border-subtle': '#e8e8f4',
      '--text-primary': '#1a1a2e',
      '--text-secondary': '#55557a',
      '--text-muted': '#8888a8',
      '--accent': '#4f46e5',
      '--accent-hover': '#6366f1',
      '--accent-subtle': '#4f46e520',
      '--success': '#16a34a',
      '--warning': '#d97706',
      '--danger': '#dc2626',
      '--scrollbar': '#d0d0e0',
    }
  },
  dracula: {
    label: 'Dracula',
    icon: '🧛',
    vars: {
      '--bg-base': '#191a21',
      '--bg-surface': '#282a36',
      '--bg-elevated': '#343746',
      '--bg-hover': '#3d4059',
      '--border': '#44475a',
      '--border-subtle': '#373a50',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#bd93f9',
      '--text-muted': '#6272a4',
      '--accent': '#ff79c6',
      '--accent-hover': '#ff92d0',
      '--accent-subtle': '#ff79c620',
      '--success': '#50fa7b',
      '--warning': '#ffb86c',
      '--danger': '#ff5555',
      '--scrollbar': '#44475a',
    }
  },
  'nord-classic': {
    label: 'Nord Classic',
    icon: '❄️',
    vars: {
      '--bg-base': '#242933',
      '--bg-surface': '#2e3440',
      '--bg-elevated': '#3b4252',
      '--bg-hover': '#434c5e',
      '--border': '#4c566a',
      '--border-subtle': '#3b4252',
      '--text-primary': '#eceff4',
      '--text-secondary': '#88c0d0',
      '--text-muted': '#616e88',
      '--accent': '#88c0d0',
      '--accent-hover': '#81a1c1',
      '--accent-subtle': '#88c0d020',
      '--success': '#a3be8c',
      '--warning': '#ebcb8b',
      '--danger': '#bf616a',
      '--scrollbar': '#4c566a',
    }
  },
  solarized: {
    label: 'Solarized',
    icon: '🌅',
    vars: {
      '--bg-base': '#001e26',
      '--bg-surface': '#002b36',
      '--bg-elevated': '#073642',
      '--bg-hover': '#0d4050',
      '--border': '#1a5060',
      '--border-subtle': '#0a3d4a',
      '--text-primary': '#fdf6e3',
      '--text-secondary': '#2aa198',
      '--text-muted': '#657b83',
      '--accent': '#268bd2',
      '--accent-hover': '#2aa198',
      '--accent-subtle': '#268bd220',
      '--success': '#859900',
      '--warning': '#b58900',
      '--danger': '#dc322f',
      '--scrollbar': '#1a5060',
    }
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    icon: '🌃',
    vars: {
      '--bg-base': '#13131e',
      '--bg-surface': '#1a1b2e',
      '--bg-elevated': '#24253a',
      '--bg-hover': '#2e2f4a',
      '--border': '#3a3b5c',
      '--border-subtle': '#2a2b44',
      '--text-primary': '#c0caf5',
      '--text-secondary': '#7aa2f7',
      '--text-muted': '#565f89',
      '--accent': '#7aa2f7',
      '--accent-hover': '#89b4fa',
      '--accent-subtle': '#7aa2f720',
      '--success': '#9ece6a',
      '--warning': '#e0af68',
      '--danger': '#f7768e',
      '--scrollbar': '#3a3b5c',
    }
  }
};


// ── Designed themes (Nov 2026) ──
// Built from one palette each so they share the fixes for "everything blends in": separate shades for
// the sidebar / page / side panel, a colour per sidebar item, tinted headings, tags and table headers,
// and the accent kept for what's selected or clickable. The extra variables (--nav-*, --h2, --tag-*, …)
// are optional: themes without them look exactly as before (see "Theme extras" in index.css).
const rgba = (hex, a) => { const h = hex.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
function designed(p) {
  return {
    '--bg-base': p.page, '--bg-surface': p.card, '--bg-sidebar': p.side, '--bg-elevated': p.elev, '--bg-hover': p.hover,
    '--border': p.border, '--border-subtle': p.sub,
    '--text-primary': p.text, '--text-secondary': p.text2, '--text-muted': p.muted,
    '--accent': p.accent, '--accent-hover': p.accent2, '--accent-subtle': rgba(p.accent, p.light ? 0.12 : 0.16),
    '--success': p.success || (p.light ? '#059669' : '#34d399'), '--warning': p.warning || (p.light ? '#d97706' : '#fbbf24'),
    '--danger': p.danger || (p.light ? '#dc2626' : '#f87171'), '--scrollbar': p.border,
    '--heading': p.heading || p.text, '--glow': p.glow || 'none',
    '--shadow': p.light ? '0 18px 50px rgba(30,40,80,0.14)' : '0 24px 60px rgba(0,0,0,0.5)',
    '--rail-bg': p.rail, '--tab-bg': p.side, '--section-label': p.label || p.accent,
    '--h2': p.h2, '--h3': p.h3, '--th-bg': p.th, '--th-text': p.thc,
    '--tag-1': p.tags[0], '--tag-2': p.tags[1], '--tag-3': p.tags[2],
    '--tag-1-bg': rgba(p.tags[0], 0.16), '--tag-2-bg': rgba(p.tags[1], 0.16), '--tag-3-bg': rgba(p.tags[2], 0.16),
    '--folder-color': p.folder, '--selected-bg': p.selectedBg || rgba(p.accent, p.light ? 0.13 : 0.18),
    '--selected-text': p.selectedText || p.text, '--selected-bar': `inset 3px 0 0 ${p.accent}`,
    ...Object.fromEntries(Object.entries(p.nav).map(([k, v]) => [`--nav-${k}`, v])),
  };
}
const NAV = (home, search, inbox, graph, tasks, ask, chats, files, trash) => ({ home, search, inbox, activity: inbox, graph, tasks, ask, chats, files, trash });

const DESIGNED = {
  signature: { label: 'Synapse Signature', icon: '⚡', p: {
    page: '#08070f', card: '#110f1f', side: '#0d0b18', rail: '#0c0a17', elev: '#1a1730', hover: '#221e3d', border: '#2d2850', sub: '#1e1a36',
    text: '#f4f2ff', text2: '#c3bee6', muted: '#8a83b5', accent: '#a855f7', accent2: '#c084fc', h2: '#22d3ee', h3: '#f472b6',
    th: 'rgba(168,85,247,0.22)', thc: '#f4f2ff', tags: ['#c084fc', '#22d3ee', '#f472b6'], folder: '#fbbf24',
    heading: 'linear-gradient(90deg, #a855f7 0%, #ec4899 50%, #22d3ee 100%)', glow: '0 0 18px rgba(168,85,247,0.35)',
    nav: NAV('#c084fc', '#a5b4fc', '#fbbf24', '#22d3ee', '#4ade80', '#f472b6', '#38bdf8', '#fb923c', '#f87171') } },
  nord: { label: 'Nord', icon: '❄️', p: {
    page: '#2e3440', card: '#353c4a', side: '#242933', rail: '#2a303b', elev: '#3b4252', hover: '#434c5e', border: '#4c566a', sub: '#3b4252',
    text: '#eceff4', text2: '#d8dee9', muted: '#8f9bb3', accent: '#88c0d0', accent2: '#8fbcbb', h2: '#88c0d0', h3: '#b48ead',
    th: '#3b4252', thc: '#ebcb8b', tags: ['#a3be8c', '#b48ead', '#d08770'], folder: '#ebcb8b', label: '#81a1c1',
    success: '#a3be8c', warning: '#ebcb8b', danger: '#bf616a', selectedBg: '#3b4252',
    nav: NAV('#81a1c1', '#d8dee9', '#ebcb8b', '#5e81ac', '#a3be8c', '#b48ead', '#8fbcbb', '#d08770', '#bf616a') } },
  layers: { label: 'Neural Layers', icon: '🧱', p: {
    page: '#0a0b14', card: '#151832', side: '#1a1d3a', rail: '#14172e', elev: '#232850', hover: '#2a305c', border: '#343a70', sub: '#2a2f5c',
    text: '#f3f4ff', text2: '#bcc0ea', muted: '#8b91c4', accent: '#8b8aff', accent2: '#a5a4ff', h2: '#ffffff', h3: '#c7c6ff',
    th: '#262b58', thc: '#f3f4ff', tags: ['#a5a4ff', '#a5a4ff', '#a5a4ff'], folder: '#fbbf24', label: '#a7a6ff', selectedBg: '#3a3f8a', selectedText: '#ffffff',
    nav: NAV('#a5a4ff', '#bcc0ea', '#a5a4ff', '#a5a4ff', '#a5a4ff', '#a5a4ff', '#a5a4ff', '#a5a4ff', '#a5a4ff') } },
  'neural-color': { label: 'Neural Color', icon: '🎨', p: {
    page: '#0b0d1a', card: '#0e1122', side: '#0d1024', rail: '#0c0f20', elev: '#141834', hover: '#1a1f42', border: '#1f2547', sub: '#171c38',
    text: '#e6e8ff', text2: '#a9aedb', muted: '#6a70a0', accent: '#7c7bff', accent2: '#a3a2ff', h2: '#c4b5fd', h3: '#67e8f9',
    th: 'rgba(124,123,255,0.22)', thc: '#e0e0ff', tags: ['#6ee7b7', '#f9a8d4', '#fcd34d'], folder: '#fbbf24', label: '#a5b4fc',
    heading: 'linear-gradient(90deg, #ffffff 0%, #b9b8ff 100%)', glow: '0 0 10px rgba(124,123,255,0.55)',
    nav: NAV('#60a5fa', '#94a3b8', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#22d3ee', '#f59e0b', '#f87171') } },
  contrast: { label: 'High Contrast', icon: '◼️', p: {
    page: '#08080b', card: '#111116', side: '#0d0d11', rail: '#0b0b0f', elev: '#18181f', hover: '#202029', border: '#2b2b36', sub: '#1f1f28',
    text: '#f7f7fa', text2: '#c2c2cc', muted: '#8a8a96', accent: '#2dd4bf', accent2: '#5eead4', h2: '#ffffff', h3: '#2dd4bf',
    th: '#18181f', thc: '#ffffff', tags: ['#2dd4bf', '#2dd4bf', '#2dd4bf'], folder: '#facc15', label: '#f7f7fa',
    selectedBg: '#2dd4bf', selectedText: '#04221e',
    nav: NAV('#f7f7fa', '#f7f7fa', '#f7f7fa', '#f7f7fa', '#f7f7fa', '#f7f7fa', '#f7f7fa', '#f7f7fa', '#f7f7fa') } },
  ember: { label: 'Ember', icon: '🔥', p: {
    page: '#1f1a17', card: '#2a221d', side: '#14110f', rail: '#181412', elev: '#2f2621', hover: '#3a2f28', border: '#4a3b31', sub: '#33291f',
    text: '#f6ece4', text2: '#d9c8bb', muted: '#9a8577', accent: '#f59e0b', accent2: '#fb923c', h2: '#fb923c', h3: '#f87171',
    th: '#3a2c22', thc: '#fcd34d', tags: ['#f59e0b', '#f87171', '#a3e635'], folder: '#fbbf24',
    nav: NAV('#fb923c', '#d6c4b6', '#fbbf24', '#f472b6', '#a3e635', '#c084fc', '#38bdf8', '#f59e0b', '#ef4444') } },
  evergreen: { label: 'Evergreen', icon: '🌲', p: {
    page: '#121c18', card: '#1a2822', side: '#0b1210', rail: '#0e1613', elev: '#1d2c25', hover: '#24382f', border: '#2e4a3e', sub: '#1f3029',
    text: '#ecf5ef', text2: '#c4d8cc', muted: '#7f9a8b', accent: '#34d399', accent2: '#a3e635', h2: '#6ee7b7', h3: '#fcd34d',
    th: '#1f3329', thc: '#fcd34d', tags: ['#34d399', '#fcd34d', '#93c5fd'], folder: '#fcd34d',
    nav: NAV('#6ee7b7', '#c4d8cc', '#fcd34d', '#93c5fd', '#a3e635', '#f0abfc', '#5eead4', '#fbbf24', '#fb7185') } },
  graphite: { label: 'Graphite', icon: '✏️', p: {
    page: '#1b1b1b', card: '#232323', side: '#111111', rail: '#151515', elev: '#262626', hover: '#2f2f2f', border: '#3a3a3a', sub: '#2a2a2a',
    text: '#f5f5f5', text2: '#cfcfcf', muted: '#8c8c8c', accent: '#c6f432', accent2: '#d9f99d', h2: '#f5f5f5', h3: '#c6f432',
    th: '#262626', thc: '#c6f432', tags: ['#c6f432', '#60a5fa', '#f472b6'], folder: '#facc15',
    nav: NAV('#60a5fa', '#cfcfcf', '#facc15', '#a78bfa', '#c6f432', '#f472b6', '#22d3ee', '#fb923c', '#f87171') } },
  abyss: { label: 'Abyss', icon: '🌊', p: {
    page: '#081726', card: '#0d2236', side: '#040d17', rail: '#06111d', elev: '#10283f', hover: '#15324f', border: '#1d4266', sub: '#123049',
    text: '#e8f4ff', text2: '#b3d1ea', muted: '#6f93b3', accent: '#2dd4bf', accent2: '#5eead4', h2: '#5eead4', h3: '#fb7185',
    th: '#0f2a44', thc: '#5eead4', tags: ['#2dd4bf', '#fb7185', '#fbbf24'], folder: '#fbbf24',
    nav: NAV('#38bdf8', '#b3d1ea', '#fbbf24', '#a78bfa', '#2dd4bf', '#f472b6', '#22d3ee', '#fb923c', '#fb7185') } },
  sakura: { label: 'Sakura', icon: '🌸', p: {
    page: '#1d141c', card: '#281b26', side: '#140e14', rail: '#181117', elev: '#2d1f2b', hover: '#3a2836', border: '#4d3447', sub: '#33232f',
    text: '#fbeef6', text2: '#e2c6d6', muted: '#a08497', accent: '#f472b6', accent2: '#f9a8d4', h2: '#f9a8d4', h3: '#6ee7b7',
    th: '#36222f', thc: '#f9a8d4', tags: ['#f472b6', '#6ee7b7', '#c4b5fd'], folder: '#fcd34d',
    nav: NAV('#f9a8d4', '#e2c6d6', '#fcd34d', '#c4b5fd', '#6ee7b7', '#f472b6', '#7dd3fc', '#fdba74', '#fb7185') } },
  dusk: { label: 'Dusk', icon: '🌆', p: {
    page: '#150e2a', card: '#201538', side: '#0d081c', rail: '#110a22', elev: '#251940', hover: '#2f2050', border: '#45306e', sub: '#2a1d48',
    text: '#fff3ec', text2: '#e5cfe6', muted: '#9c84b4', accent: '#ff4fa3', accent2: '#ff8a4c', h2: '#ff8a4c', h3: '#ffd166',
    th: '#2c1a4a', thc: '#ffd166', tags: ['#ff4fa3', '#ff8a4c', '#ffd166'], folder: '#ffd166',
    nav: NAV('#ff8a4c', '#e5cfe6', '#ffd166', '#b388ff', '#5eead4', '#ff4fa3', '#67e8f9', '#ffb347', '#ff5d73') } },
  paper: { label: 'Warm Paper', icon: '📜', p: { light: true,
    page: '#fbf8f2', card: '#ffffff', side: '#f1ebdf', rail: '#f6f1e7', elev: '#f4eee3', hover: '#ebe2d2', border: '#e2d7c3', sub: '#ece3d4',
    text: '#2a2118', text2: '#5e5244', muted: '#94877a', accent: '#4f46e5', accent2: '#4338ca', h2: '#c2410c', h3: '#4f46e5',
    th: '#f4eee3', thc: '#2a2118', tags: ['#c2410c', '#4f46e5', '#047857'], folder: '#b45309', label: '#c2410c', selectedBg: '#ffffff',
    nav: NAV('#2563eb', '#5e5244', '#d97706', '#7c3aed', '#059669', '#db2777', '#0891b2', '#b45309', '#dc2626') } },
  daybreak: { label: 'Daybreak', icon: '🌅', p: { light: true,
    page: '#ffffff', card: '#ffffff', side: '#eef4ff', rail: '#f5f8ff', elev: '#eef2fb', hover: '#e3eaf8', border: '#d6deef', sub: '#e6ecf7',
    text: '#1b2238', text2: '#45506e', muted: '#8590ad', accent: '#6d28d9', accent2: '#5b21b6', h2: '#6d28d9', h3: '#0d9488',
    th: '#eef2fb', thc: '#6d28d9', tags: ['#6d28d9', '#0d9488', '#db2777'], folder: '#d97706',
    nav: NAV('#2563eb', '#45506e', '#d97706', '#7c3aed', '#059669', '#db2777', '#0891b2', '#ea580c', '#dc2626') } },
  arctic: { label: 'Arctic', icon: '🧊', p: { light: true,
    page: '#ffffff', card: '#ffffff', side: '#e8f2fa', rail: '#f2f8fc', elev: '#e9f1f8', hover: '#dcebf6', border: '#c9dbea', sub: '#dfeaf4',
    text: '#0f2740', text2: '#3b5873', muted: '#7f97ad', accent: '#0284c7', accent2: '#0369a1', h2: '#0369a1', h3: '#0e7490',
    th: '#e6f1f9', thc: '#0369a1', tags: ['#0284c7', '#0f766e', '#7c3aed'], folder: '#ca8a04',
    nav: NAV('#0284c7', '#3b5873', '#ca8a04', '#7c3aed', '#059669', '#db2777', '#0891b2', '#ea580c', '#dc2626') } },
};
for (const [key, t] of Object.entries(DESIGNED)) THEMES[key] = { label: t.label, icon: t.icon, light: !!t.p.light, vars: designed(t.p) };

const LIGHT_THEMES = new Set(['light', 'neural-light', ...Object.keys(THEMES).filter(k => THEMES[k].light)]);
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;
let currentTheme = 'auto';
let setVars = new Set();

function resolve(themeName) {
  if (themeName === 'auto' || !THEMES[themeName]) return media?.matches ? 'neural-light' : 'neural';
  return themeName;
}

export function applyTheme(themeName) {
  currentTheme = themeName || 'auto';
  const key = resolve(currentTheme);
  const vars = THEMES[key].vars;
  const root = document.documentElement;
  const all = {
    '--bg-sidebar': vars['--bg-surface'],
    '--heading': vars['--text-primary'],
    '--glow': 'none',
    '--shadow': '0 24px 60px rgba(0,0,0,0.4)',
    ...vars,
  };
  // Remove variables the previous theme set that this one doesn't (e.g. the designed themes' extras).
  for (const k of setVars) if (!(k in all)) root.style.removeProperty(k);
  setVars = new Set(Object.keys(all));
  Object.entries(all).forEach(([k, v]) => root.style.setProperty(k, v));
  root.setAttribute('data-theme', key);
  // data-scheme lets CSS and code ask "light or dark?" without knowing every theme's name
  root.setAttribute('data-scheme', LIGHT_THEMES.has(key) ? 'light' : 'dark');
  root.style.colorScheme = LIGHT_THEMES.has(key) ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg-base']);
}

// Follow the device's light/dark setting while on Auto.
media?.addEventListener?.('change', () => { if (currentTheme === 'auto') applyTheme('auto'); });

export function isLightTheme(themeName) {
  return LIGHT_THEMES.has(resolve(themeName));
}
