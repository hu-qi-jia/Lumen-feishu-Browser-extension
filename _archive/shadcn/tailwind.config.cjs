/** @type {import('tailwindcss').Config} */
module.exports = {
  // 项目用 [data-theme="dark"] 切换暗色，不用 class="dark"
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/sidepanel/ui/**/*.{ts,tsx}',
    './src/sidepanel/components/**/*.{ts,tsx}',
    './src/sidepanel/*.tsx',
  ],
  // 关掉 Preflight —— 现有 App.css 有自己的样式体系，Preflight 的全局重置会破坏
  // 现有组件。新 M3 组件在根元素显式加 `box-border` 等 utility 即可。
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        // shadcn 标准色名 —— 指向 tokens.css 里的 --background / --primary 等 CSS 变量
        // 这些变量在 :root 和 [data-theme="dark"] 里都映射到对应 M3 token
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        // M3 原生色板（保留给需要精细控制的场景）
        m3: {
          primary: 'var(--m3-primary)',
          'on-primary': 'var(--m3-on-primary)',
          'primary-container': 'var(--m3-primary-container)',
          'on-primary-container': 'var(--m3-on-primary-container)',
          secondary: 'var(--m3-secondary)',
          'on-secondary': 'var(--m3-on-secondary)',
          'secondary-container': 'var(--m3-secondary-container)',
          'on-secondary-container': 'var(--m3-on-secondary-container)',
          tertiary: 'var(--m3-tertiary)',
          'on-tertiary': 'var(--m3-on-tertiary)',
          'tertiary-container': 'var(--m3-tertiary-container)',
          'on-tertiary-container': 'var(--m3-on-tertiary-container)',
          error: 'var(--m3-error)',
          'on-error': 'var(--m3-on-error)',
          'error-container': 'var(--m3-error-container)',
          'on-error-container': 'var(--m3-on-error-container)',
          background: 'var(--m3-background)',
          'on-background': 'var(--m3-on-background)',
          surface: 'var(--m3-surface)',
          'on-surface': 'var(--m3-on-surface)',
          'surface-variant': 'var(--m3-surface-variant)',
          'on-surface-variant': 'var(--m3-on-surface-variant)',
          'surface-lowest': 'var(--m3-surface-container-lowest)',
          'surface-low': 'var(--m3-surface-container-low)',
          'surface-container': 'var(--m3-surface-container)',
          'surface-high': 'var(--m3-surface-container-high)',
          'surface-highest': 'var(--m3-surface-container-highest)',
          outline: 'var(--m3-outline)',
          'outline-variant': 'var(--m3-outline-variant)',
          scrim: 'var(--m3-scrim)',
          'inverse-surface': 'var(--m3-inverse-surface)',
          'inverse-on-surface': 'var(--m3-inverse-on-surface)',
        },
      },
      borderRadius: {
        'm3-xs': 'var(--m3-radius-xs)',
        'm3-sm': 'var(--m3-radius-sm)',
        'm3-md': 'var(--m3-radius-md)',
        'm3-lg': 'var(--m3-radius-lg)',
        'm3-xl': 'var(--m3-radius-xl)',
        'm3-full': 'var(--m3-radius-full)',
      },
      fontFamily: {
        m3: 'var(--m3-font-family)',
      },
      fontSize: {
        // M3 Type scale
        'm3-xs': ['0.6875rem', { lineHeight: '1rem' }],     // 11px label
        'm3-sm': ['0.75rem', { lineHeight: '1.125rem' }],   // 12px body small
        'm3-base': ['0.875rem', { lineHeight: '1.25rem' }], // 14px body
        'm3-lg': ['1rem', { lineHeight: '1.5rem' }],        // 16px title
        'm3-xl': ['1.375rem', { lineHeight: '1.75rem' }],   // 22px headline
        'm3-2xl': ['1.75rem', { lineHeight: '2.25rem' }],   // 28px display
      },
      boxShadow: {
        'm3-1': 'var(--m3-elevation-1)',
        'm3-2': 'var(--m3-elevation-2)',
        'm3-3': 'var(--m3-elevation-3)',
        'm3-4': 'var(--m3-elevation-4)',
        'm3-5': 'var(--m3-elevation-5)',
      },
      transitionTimingFunction: {
        // M3 standard easing
        'm3-standard': 'cubic-bezier(0.2, 0, 0, 1)',
        'm3-emphasized': 'cubic-bezier(0.3, 0, 0, 1)',
        'm3-decelerate': 'cubic-bezier(0, 0, 0, 1)',
        'm3-accelerate': 'cubic-bezier(0.3, 0, 1, 1)',
      },
    },
  },
  plugins: [],
}
