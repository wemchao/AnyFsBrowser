const assert = require("node:assert/strict");
const test = require("node:test");
const markdownIt = require("markdown-it");
const katex = require("katex");
const texmath = require("markdown-it-texmath");

function render(source) {
  return markdownIt({ html: false, linkify: true })
    .use(texmath, {
      engine: katex,
      delimiters: ["dollars", "brackets", "beg_end"],
      katexOptions: {
        throwOnError: false,
        strict: false,
        trust: false,
      },
    })
    .render(source);
}

test("renders bracket-delimited formulas used by engineering documents", () => {
  const html = render(String.raw`
\[
L_{cls} =
\frac{\sum L_{pos}}{N_{pos}} +
\lambda_{neg}\frac{\sum L_{neg}}{N_{neg}}
\]
`);

  assert.match(html, /class="katex-display"/);
  assert.doesNotMatch(html, /\\\[/);
  assert.match(html, /lambda/);
});

test("renders inline brackets, dollar formulas, and LaTeX environments together", () => {
  const html = render(String.raw`
Inline \(x^2\) and $y^2$.

$$z = 1$$

\begin{equation}
a = b
\end{equation}
`);

  assert.equal((html.match(/class="katex"/g) || []).length, 4);
  assert.doesNotMatch(html, /<p>\\begin\{equation\}/);
});
