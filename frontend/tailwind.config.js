/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        brand: {
          teal:  '#0F6E56',
          tealL: '#E1F5EE',
          tealM: '#1D9E75',
        },
      },
    },
  },
  plugins: [],
}
