import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  ...nextCoreWebVitals,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    files: ['src/app/layout.tsx'],
    rules: {
      '@next/next/no-page-custom-font': 'off',
    },
  },
  {
    // One colour template (docs/COLOURS.md): colour literals live only in
    // the tokens (src/app/globals.css) and their JS mirror
    // (src/utils/chartTheme.js). src/colourGuard.test.js checks CSS too.
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: ['src/utils/chartTheme.js', 'src/test/colourGuard.js', 'src/colourGuard.test.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/(^|[^\\w&])(#|%23)(?!\\d{4}(?![\\da-fA-F]))([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\\w-])|\\b(rgba?|hsla?)\\(\\s*[-\\d.]/]',
          message: 'Colour literal: use a token from src/utils/chartTheme.js or policyConfig.js (docs/COLOURS.md).',
        },
        {
          selector:
            'TemplateElement[value.raw=/(^|[^\\w&])(#|%23)(?!\\d{4}(?![\\da-fA-F]))([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\\w-])|\\b(rgba?|hsla?)\\(\\s*[-\\d.]/]',
          message: 'Colour literal: use a token from src/utils/chartTheme.js or policyConfig.js (docs/COLOURS.md).',
        },
        {
          selector:
            ':matches(Property[key.name=/^(colou?r|fill|stroke|background(Color)?|border(Top|Right|Bottom|Left)?Color|outlineColor|stopColor)$/], JSXAttribute[name.name=/^(fill|stroke|color|stopColor)$/]) > Literal[value=/^(white|black|red|green|blue|grey|gray|orange|yellow|purple|pink|teal|navy|silver)$/i]',
          message: 'Named colour: use a token from src/utils/chartTheme.js (docs/COLOURS.md).',
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'public/**',
  ]),
]);
