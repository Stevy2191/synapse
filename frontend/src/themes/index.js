export const THEMES = {
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

export function applyTheme(themeName) {
  const theme = THEMES[themeName] || THEMES.dark;
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.setAttribute('data-theme', themeName);
}
