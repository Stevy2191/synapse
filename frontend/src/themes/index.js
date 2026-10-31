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
  nord: {
    label: 'Nord',
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

const LIGHT_THEMES = new Set(['light', 'neural-light']);
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;
let currentTheme = 'auto';

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
  Object.entries(all).forEach(([k, v]) => root.style.setProperty(k, v));
  root.setAttribute('data-theme', key);
  root.style.colorScheme = LIGHT_THEMES.has(key) ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg-base']);
}

// Follow the device's light/dark setting while on Auto.
media?.addEventListener?.('change', () => { if (currentTheme === 'auto') applyTheme('auto'); });

export function isLightTheme(themeName) {
  return LIGHT_THEMES.has(resolve(themeName));
}
