const process = require('node:process');

process.env.ESLINT_TSCONFIG = 'tsconfig.json';

module.exports = {

  extends: '@antfu',

  rules: {
    'semi': ['error', 'always'],
    '@typescript-eslint/semi': ['error', 'always'],
    'antfu/top-level-function': 'off',
  },

};
