import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0D7EC7',
        secondary: '#003E68',
        neutral: '#666666',
        surface: '#F4F6F8',
        'color-border': '#E2E8F0',
        success: '#2E7D32',
        error: '#C62828',
        warning: '#F9A825',
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        card: '0 1px 4px 0 rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
