// Minimal working config. The repo shipped with eslint + @shopify/eslint-plugin
// installed but no config file at all, so `npm run lint` had never actually run.
// This keeps the rule set small and high-signal (correctness over style; tsc and
// the build carry the type-level load).
module.exports = {
  root: true,
  ignorePatterns: ["build/", "node_modules/", "extensions/", "*.cjs"],
  overrides: [
    {
      files: ["**/*.{ts,tsx}"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      plugins: ["@typescript-eslint", "react", "react-hooks"],
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
      ],
      settings: { react: { version: "detect" } },
      rules: {
        // tsc already checks unused locals more precisely; keep the lint rule
        // but allow the _-prefix convention for intentionally unused values.
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        // Server code logs on purpose; there is no client console budget here.
        "no-console": "off",
        // Remix route modules export loaders/actions whose types come from the
        // framework; explicit any appears at a few interop edges. Warn, not error.
        "@typescript-eslint/no-explicit-any": "warn",
        // App Bridge's SaveBar children are plain <button> elements that take
        // web-component attributes (variant, loading); its type package
        // augments React's ButtonHTMLAttributes, but this rule has no idea.
        "react/no-unknown-property": ["error", { ignore: ["variant", "loading"] }],
        // Prose in JSX (privacy policy and the like) uses real apostrophes and
        // quotes; entity-escaping them is churn with no correctness payoff.
        "react/no-unescaped-entities": "off",
      },
    },
  ],
};
