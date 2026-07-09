/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: '#F5A623',
        'gold-hover': '#e8940f',
        cream: '#FAF8F3',
        'cream-alt': '#FFF8EE',
        navy: '#0a1628',
        'border-gold': '#e8d5a3',
        'card-border': '#f0e8d0',
      },
      fontFamily: {
        playfair: ['"Playfair Display"', 'Georgia', 'serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
