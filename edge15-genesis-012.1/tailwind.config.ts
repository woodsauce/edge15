import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        edge: {
          bg: '#070A12',
          panel: '#0D1324',
          muted: '#8A95AD',
          line: '#1F2A44',
          green: '#29D17D',
          amber: '#FFCF5A',
          red: '#FF5B6E',
          blue: '#71A7FF'
        }
      }
    },
  },
  plugins: [],
};

export default config;
