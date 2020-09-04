module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: [
        '@typescript-eslint',
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    rules: {
        "quotes": [2, "double", { "avoidEscape": true }],
        "no-multiple-empty-lines": ["error", { "max": 2, "maxEOF": 0, "maxBOF": 0 } ],
    },
};