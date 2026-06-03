"use client";

import { memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * Markdown renderer with explicit element styling. The app has no @tailwindcss/typography
 * plugin, so `prose` is a no-op here — we style each element with utilities instead so
 * lists, code, tables, links etc. actually render readably.
 */
const components: Components = {
  p: (p) => <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-1.5 list-disc space-y-0.5 pl-5" {...p} />,
  ol: (p) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  a: (p) => <a className="text-primary underline underline-offset-2 hover:opacity-80" target="_blank" rel="noreferrer" {...p} />,
  strong: (p) => <strong className="font-semibold" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  h1: (p) => <h1 className="mb-1.5 mt-3 text-base font-semibold first:mt-0" {...p} />,
  h2: (p) => <h2 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0" {...p} />,
  h3: (p) => <h3 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0" {...p} />,
  blockquote: (p) => <blockquote className="my-1.5 border-l-2 border-border pl-3 italic text-muted-foreground" {...p} />,
  hr: () => <hr className="my-3 border-border" />,
  pre: (p) => <pre className="my-2 overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-[12px] leading-relaxed" {...p} />,
  code: ({ className, children, ...rest }: ComponentPropsWithoutRef<"code">) => {
    const inline = !className?.includes("language-");
    return inline ? (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...rest}>{children}</code>
    ) : (
      <code className={className} {...rest}>{children}</code>
    );
  },
  table: (p) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs" {...p} /></div>,
  th: (p) => <th className="border px-2 py-1 text-left font-semibold" {...p} />,
  td: (p) => <td className="border px-2 py-1" {...p} />,
};

function MarkdownImpl({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="max-w-none break-words text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>{text}</ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
