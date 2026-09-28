export type ThemeMode = 'dark' | 'light';

export interface AppTheme {
  id: string;
  name: string;
  mode: ThemeMode;
  diff: string;
  colors: Record<'bg' | 'bgElev' | 'bgHover' | 'bgActive' | 'border' | 'borderSoft' | 'text' | 'text2' | 'text3' | 'text4' | 'accent' | 'ok' | 'bad' | 'wait', string>;
}

export const SYSTEM_THEME_ID = 'system';

export const THEMES: readonly AppTheme[] = [
  { id: 'dark', name: 'PR Review Dark', mode: 'dark', diff: 'pierre-dark', colors: { bg: '#0f1011', bgElev: '#141516', bgHover: '#1c1d1f', bgActive: '#232427', border: '#23252a', borderSoft: '#1b1c1f', text: '#f7f8f8', text2: '#d0d6e0', text3: '#8a8f98', text4: '#62666d', accent: '#5e6ad2', ok: '#4cb782', bad: '#eb5757', wait: '#f2c94c' } },
  { id: 'light', name: 'PR Review Light', mode: 'light', diff: 'pierre-light', colors: { bg: '#ffffff', bgElev: '#fafafa', bgHover: '#f3f3f5', bgActive: '#ececef', border: '#e3e3e6', borderSoft: '#eeeef0', text: '#16171a', text2: '#33363d', text3: '#6b6f76', text4: '#9a9ea6', accent: '#5e6ad2', ok: '#26a269', bad: '#d93838', wait: '#b7860b' } },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', mode: 'dark', diff: 'catppuccin-mocha', colors: { bg: '#1e1e2e', bgElev: '#181825', bgHover: '#313244', bgActive: '#45475a', border: '#313244', borderSoft: '#26263a', text: '#cdd6f4', text2: '#bac2de', text3: '#9399b2', text4: '#6c7086', accent: '#89b4fa', ok: '#a6e3a1', bad: '#f38ba8', wait: '#f9e2af' } },
  { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', mode: 'dark', diff: 'catppuccin-macchiato', colors: { bg: '#24273a', bgElev: '#1e2030', bgHover: '#363a4f', bgActive: '#494d64', border: '#363a4f', borderSoft: '#2b2e43', text: '#cad3f5', text2: '#b8c0e0', text3: '#939ab7', text4: '#6e738d', accent: '#8aadf4', ok: '#a6da95', bad: '#ed8796', wait: '#eed49f' } },
  { id: 'catppuccin-frappe', name: 'Catppuccin Frappé', mode: 'dark', diff: 'catppuccin-frappe', colors: { bg: '#303446', bgElev: '#292c3c', bgHover: '#414559', bgActive: '#51576d', border: '#414559', borderSoft: '#373a4e', text: '#c6d0f5', text2: '#b5bfe2', text3: '#949cbb', text4: '#737994', accent: '#8caaee', ok: '#a6d189', bad: '#e78284', wait: '#e5c890' } },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', mode: 'light', diff: 'catppuccin-latte', colors: { bg: '#eff1f5', bgElev: '#e6e9ef', bgHover: '#dce0e8', bgActive: '#ccd0da', border: '#ccd0da', borderSoft: '#dce0e8', text: '#4c4f69', text2: '#5c5f77', text3: '#7c7f93', text4: '#9ca0b0', accent: '#1e66f5', ok: '#40a02b', bad: '#d20f39', wait: '#df8e1d' } },
  { id: 'tokyo-night', name: 'Tokyo Night', mode: 'dark', diff: 'tokyo-night', colors: { bg: '#1a1b26', bgElev: '#16161e', bgHover: '#232433', bgActive: '#2f3146', border: '#292e42', borderSoft: '#1f2030', text: '#c0caf5', text2: '#a9b1d6', text3: '#787c99', text4: '#565f89', accent: '#7aa2f7', ok: '#9ece6a', bad: '#f7768e', wait: '#e0af68' } },
  { id: 'dracula', name: 'Dracula', mode: 'dark', diff: 'dracula', colors: { bg: '#282a36', bgElev: '#21222c', bgHover: '#343746', bgActive: '#44475a', border: '#3a3c4e', borderSoft: '#2f313f', text: '#f8f8f2', text2: '#e2e2dc', text3: '#a4a8c0', text4: '#6272a4', accent: '#bd93f9', ok: '#50fa7b', bad: '#ff5555', wait: '#f1fa8c' } },
  { id: 'one-dark-pro', name: 'One Dark Pro', mode: 'dark', diff: 'one-dark-pro', colors: { bg: '#282c34', bgElev: '#21252b', bgHover: '#2c313a', bgActive: '#3a3f4b', border: '#3b4048', borderSoft: '#2c313a', text: '#e6e6e6', text2: '#abb2bf', text3: '#7f848e', text4: '#5c6370', accent: '#61afef', ok: '#98c379', bad: '#e06c75', wait: '#e5c07b' } },
  { id: 'github-dark', name: 'GitHub Dark', mode: 'dark', diff: 'github-dark-default', colors: { bg: '#0d1117', bgElev: '#010409', bgHover: '#161b22', bgActive: '#21262d', border: '#30363d', borderSoft: '#21262d', text: '#f0f6fc', text2: '#c9d1d9', text3: '#8b949e', text4: '#6e7681', accent: '#2f81f7', ok: '#3fb950', bad: '#f85149', wait: '#d29922' } },
  { id: 'github-light', name: 'GitHub Light', mode: 'light', diff: 'github-light-default', colors: { bg: '#ffffff', bgElev: '#f6f8fa', bgHover: '#eff2f5', bgActive: '#e6eaef', border: '#d0d7de', borderSoft: '#e6eaef', text: '#1f2328', text2: '#31363c', text3: '#59636e', text4: '#818b98', accent: '#0969da', ok: '#1a7f37', bad: '#cf222e', wait: '#9a6700' } },
  { id: 'nord', name: 'Nord', mode: 'dark', diff: 'nord', colors: { bg: '#2e3440', bgElev: '#292e39', bgHover: '#3b4252', bgActive: '#434c5e', border: '#3b4252', borderSoft: '#343b48', text: '#eceff4', text2: '#d8dee9', text3: '#a0a8b7', text4: '#6c7689', accent: '#88c0d0', ok: '#a3be8c', bad: '#bf616a', wait: '#ebcb8b' } },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', mode: 'dark', diff: 'gruvbox-dark-medium', colors: { bg: '#282828', bgElev: '#1d2021', bgHover: '#32302f', bgActive: '#3c3836', border: '#3c3836', borderSoft: '#32302f', text: '#fbf1c7', text2: '#ebdbb2', text3: '#a89984', text4: '#7c6f64', accent: '#83a598', ok: '#b8bb26', bad: '#fb4934', wait: '#fabd2f' } },
  { id: 'rose-pine', name: 'Rosé Pine', mode: 'dark', diff: 'rose-pine', colors: { bg: '#191724', bgElev: '#1f1d2e', bgHover: '#26233a', bgActive: '#403d52', border: '#26233a', borderSoft: '#21202e', text: '#e0def4', text2: '#c8c5e0', text3: '#908caa', text4: '#6e6a86', accent: '#c4a7e7', ok: '#9ccfd8', bad: '#eb6f92', wait: '#f6c177' } },
  { id: 'solarized-dark', name: 'Solarized Dark', mode: 'dark', diff: 'solarized-dark', colors: { bg: '#002b36', bgElev: '#00252f', bgHover: '#073642', bgActive: '#0d4452', border: '#0d3f4c', borderSoft: '#063440', text: '#eee8d5', text2: '#c3cdcd', text3: '#93a1a1', text4: '#657b83', accent: '#268bd2', ok: '#859900', bad: '#dc322f', wait: '#b58900' } },
  { id: 'solarized-light', name: 'Solarized Light', mode: 'light', diff: 'solarized-light', colors: { bg: '#fdf6e3', bgElev: '#f5efdc', bgHover: '#eee8d5', bgActive: '#e4ddc8', border: '#e1dac4', borderSoft: '#eee8d5', text: '#073642', text2: '#35535c', text3: '#657b83', text4: '#93a1a1', accent: '#268bd2', ok: '#859900', bad: '#dc322f', wait: '#b58900' } },
  { id: 'monokai', name: 'Monokai', mode: 'dark', diff: 'monokai', colors: { bg: '#272822', bgElev: '#1e1f1c', bgHover: '#34352f', bgActive: '#414339', border: '#3e3d32', borderSoft: '#2f302a', text: '#f8f8f2', text2: '#e6e6de', text3: '#a59f85', text4: '#75715e', accent: '#66d9ef', ok: '#a6e22e', bad: '#f92672', wait: '#e6db74' } },
  { id: 'night-owl', name: 'Night Owl', mode: 'dark', diff: 'night-owl', colors: { bg: '#011627', bgElev: '#01111d', bgHover: '#0b2942', bgActive: '#13344f', border: '#122d42', borderSoft: '#0b2236', text: '#e6ebf2', text2: '#d6deeb', text3: '#8badc1', text4: '#5f7e97', accent: '#82aaff', ok: '#addb67', bad: '#ef5350', wait: '#ecc48d' } },
  { id: 'kanagawa', name: 'Kanagawa', mode: 'dark', diff: 'kanagawa-wave', colors: { bg: '#1f1f28', bgElev: '#16161d', bgHover: '#2a2a37', bgActive: '#363646', border: '#2a2a37', borderSoft: '#23232e', text: '#dcd7ba', text2: '#c8c093', text3: '#9a9a8e', text4: '#727169', accent: '#7e9cd8', ok: '#98bb6c', bad: '#e46876', wait: '#e6c384' } },
  { id: 'vesper', name: 'Vesper', mode: 'dark', diff: 'vesper', colors: { bg: '#101010', bgElev: '#161616', bgHover: '#1c1c1c', bgActive: '#232323', border: '#282828', borderSoft: '#1c1c1c', text: '#ffffff', text2: '#d6d6d6', text3: '#a0a0a0', text4: '#6b6b6b', accent: '#ffc799', ok: '#99ffe4', bad: '#ff8080', wait: '#ffc799' } },
];

const THEME_VARIABLES: Record<keyof AppTheme['colors'], string> = {
  bg: '--bg', bgElev: '--bg-elev', bgHover: '--bg-hover', bgActive: '--bg-active', border: '--border', borderSoft: '--border-soft',
  text: '--text', text2: '--text-2', text3: '--text-3', text4: '--text-4', accent: '--accent', ok: '--ok', bad: '--bad', wait: '--wait',
};

export function themeById(id: string): AppTheme | undefined {
  return THEMES.find((theme) => theme.id === id);
}

export function applyThemeColors(root: HTMLElement, theme: AppTheme): void {
  root.dataset.theme = theme.mode;
  root.dataset.themeId = theme.id;
  root.style.colorScheme = theme.mode;
  (Object.keys(THEME_VARIABLES) as (keyof AppTheme['colors'])[]).forEach((key) => root.style.setProperty(THEME_VARIABLES[key], theme.colors[key]));
  root.style.setProperty('--accent-hover', theme.colors.accent);
  root.style.setProperty('--add', theme.colors.ok);
  root.style.setProperty('--del', theme.colors.bad);
  root.style.setProperty('--toast-bg', theme.colors.bgElev);
  root.style.setProperty('--diffs-card-border', theme.colors.border);
  root.style.setProperty('--dialog-bg', theme.colors.bgElev);
}
