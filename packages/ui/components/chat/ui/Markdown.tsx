"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/** Minimal markdown renderer reusing the app's react-markdown stack. */
function MarkdownImpl({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{text}</ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
