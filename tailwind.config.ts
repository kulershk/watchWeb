import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0f1117',
        surface: '#1a1d27',
        'surface-light': '#252836',
        border: '#2e3244',
        text: '#e4e4e7',
        'text-muted': '#9ca3af',
        primary: '#e8a0bf',
        'primary-hover': '#d68aad',
        accent: '#5eead4',
        'accent-hover': '#4dd4b8',
        danger: '#f87171',
      },
    },
  },
  plugins: [],
} satisfies Config
