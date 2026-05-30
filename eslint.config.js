const js = require("@eslint/js");
const unusedImports = require("eslint-plugin-unused-imports");

module.exports = [
    js.configs.recommended,
    {
        plugins: {
            "unused-imports": unusedImports,
        },
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: {
                process: "readonly",
                __dirname: "readonly",
                console: "readonly",
                require: "readonly",
                module: "readonly",
                Buffer: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                URL: "readonly",
                fetch: "readonly",
                AbortController: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "off",
            "unused-imports/no-unused-imports": "error",
            "unused-imports/no-unused-vars": "off",
            "no-empty": "off",
            "no-case-declarations": "off",
            "no-irregular-whitespace": "off"
        }
    }
];
