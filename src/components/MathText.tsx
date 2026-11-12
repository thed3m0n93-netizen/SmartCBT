import katex from "katex";

interface MathTextProps {
  content: string;
  formula?: string | null;
  className?: string;
}

function renderFormula(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source.trim(), {
      displayMode,
      throwOnError: false,
      strict: "ignore",
    });
  } catch {
    return source;
  }
}

function renderLatex(content: string, formula?: string | null): string {
  const mathPattern = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g;
  let foundMath = false;
  const rendered = content.replace(mathPattern, (match) => {
    foundMath = true;
    const displayMode = match.startsWith("$$") || match.startsWith("\\[");
    const source = displayMode || match.startsWith("\\(")
      ? match.slice(2, -2)
      : match.slice(1, -1);
    return renderFormula(source, displayMode);
  });

  if (formula?.trim() && !foundMath) {
    return `${rendered}<div class="my-3">${renderFormula(formula, true)}</div>`;
  }
  return rendered;
}

export default function MathText({ content, formula, className }: MathTextProps) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderLatex(content, formula) }} />;
}