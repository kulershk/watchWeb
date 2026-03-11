import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#121212',
        surface: '#282828',
        'surface-light': '#333333',
        border: '#535353',
        text: '#ffffff',
        'text-muted': '#b3b3b3',
        primary: '#1db954',
        'primary-hover': '#1ed760',
        accent: '#1db954',
        'accent-hover': '#1ed760',
        danger: '#e22134',
      },
    },
  },
  plugins: [],
} satisfies Config
