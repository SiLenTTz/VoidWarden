import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginN from "eslint-plugin-n";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "data/**",
      ".pio/**",
      // Firmware ist C++ (clang-format im Gate), kein ESLint-Zuständigkeitsbereich.
      "firmware/**",
      // Web-PWA: eigener tsconfig + DOM-Umgebung; dist ist Build-Artefakt.
      "web/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["web/public/**/*.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        location: "readonly",
        URL: "readonly",
        Request: "readonly",
        Response: "readonly",
        clients: "readonly",
      },
    },
  },
  {
    files: ["web/src/**/*.ts", "web/test/**/*.ts"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        location: "readonly",
        navigator: "readonly",
        Notification: "readonly",
        AudioContext: "readonly",
        WebSocket: "readonly",
        HTMLElement: "readonly",
        HTMLDialogElement: "readonly",
        HTMLButtonElement: "readonly",
        MessageEvent: "readonly",
        setInterval: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        performance: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
      },
    },
    plugins: { n: eslintPluginN },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "n/no-missing-import": "off",
      "n/handle-callback-err": "error",
      eqeqeq: ["error", "smart"],
      "no-console": "off",
    },
  },
);
