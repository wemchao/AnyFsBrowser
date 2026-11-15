const hljs = require("highlight.js/lib/common");

globalThis.CodeHighlighter = {
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return {
        language,
        html: hljs.highlight(code, { language, ignoreIllegals: true }).value,
      };
    }
    const result = hljs.highlightAuto(code);
    return { language: result.language || "plaintext", html: result.value };
  },
};
