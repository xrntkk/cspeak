import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

import bash from "react-syntax-highlighter/dist/cjs/languages/prism/bash";
import javascript from "react-syntax-highlighter/dist/cjs/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/cjs/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/cjs/languages/prism/jsx";
import markdown from "react-syntax-highlighter/dist/cjs/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/cjs/languages/prism/python";
import rust from "react-syntax-highlighter/dist/cjs/languages/prism/rust";
import tsx from "react-syntax-highlighter/dist/cjs/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/cjs/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/cjs/languages/prism/yaml";

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("yaml", yaml);

interface MarkdownContentProps {
  children: string;
  compact?: boolean;
  className?: string;
}

function useDarkMode() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const update = () =>
      setDark(document.documentElement.classList.contains("dark"));
    update();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          update();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return dark;
}

function createComponents(dark: boolean, compact?: boolean): Components {
  return {
    code({ className, children }) {
      const match = /language-(\w+)/.exec(className || "");
      const code = String(children).replace(/\n$/, "");

      if (match) {
        return (
          <div
            className={cn(
              "my-2 overflow-x-auto rounded-md bg-muted",
              compact ? "p-2" : "p-3",
            )}
          >
            <SyntaxHighlighter
              language={match[1]}
              style={dark ? oneDark : oneLight}
              PreTag="div"
              customStyle={{
                margin: 0,
                padding: 0,
                background: "transparent",
              }}
              className="text-sm"
            >
              {code}
            </SyntaxHighlighter>
          </div>
        );
      }

      return (
        <code
          className={cn(
            "rounded bg-muted px-1 py-0.5 text-sm font-mono",
            className,
          )}
        >
          {children}
        </code>
      );
    },

    p({ children }) {
      return compact ? (
        <span className="inline leading-normal">{children}</span>
      ) : (
        <p className="mb-2 leading-normal">{children}</p>
      );
    },

    a({ children, href }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {children}
        </a>
      );
    },

    ul({ children }) {
      return (
        <ul
          className={cn("list-disc pl-5", compact ? "my-1" : "my-2")}
        >
          {children}
        </ul>
      );
    },

    ol({ children }) {
      return (
        <ol
          className={cn("list-decimal pl-5", compact ? "my-1" : "my-2")}
        >
          {children}
        </ol>
      );
    },

    li({ children }) {
      return <li className="leading-normal">{children}</li>;
    },

    blockquote({ children }) {
      return (
        <blockquote
          className={cn(
            "border-l-2 border-border pl-3 text-muted-foreground",
            compact ? "my-1" : "my-2",
          )}
        >
          {children}
        </blockquote>
      );
    },

    hr() {
      return <hr className="my-3 border-border" />;
    },

    h1({ children }) {
      return (
        <h1
          className={cn(
            "font-semibold text-foreground",
            compact ? "my-1 text-base" : "mb-2 mt-3 text-xl",
          )}
        >
          {children}
        </h1>
      );
    },

    h2({ children }) {
      return (
        <h2
          className={cn(
            "font-semibold text-foreground",
            compact ? "my-1 text-sm" : "mb-2 mt-3 text-lg",
          )}
        >
          {children}
        </h2>
      );
    },

    h3({ children }) {
      return (
        <h3
          className={cn(
            "font-semibold text-foreground",
            compact ? "my-1 text-sm" : "mb-1 mt-2 text-base",
          )}
        >
          {children}
        </h3>
      );
    },

    h4({ children }) {
      return (
        <h4
          className={cn(
            "font-semibold text-foreground text-sm",
            compact ? "my-0.5" : "my-1",
          )}
        >
          {children}
        </h4>
      );
    },

    h5({ children }) {
      return (
        <h5
          className={cn(
            "font-semibold text-foreground text-xs",
            compact ? "my-0.5" : "my-1",
          )}
        >
          {children}
        </h5>
      );
    },

    h6({ children }) {
      return (
        <h6
          className={cn(
            "font-semibold text-foreground text-xs",
            compact ? "my-0.5" : "my-1",
          )}
        >
          {children}
        </h6>
      );
    },

    table({ children }) {
      return (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      );
    },

    thead({ children }) {
      return <thead className="bg-muted">{children}</thead>;
    },

    th({ children }) {
      return (
        <th className="border border-border px-2 py-1 text-left font-medium">
          {children}
        </th>
      );
    },

    td({ children }) {
      return (
        <td className="border border-border px-2 py-1">{children}</td>
      );
    },

    img({ src, alt }) {
      return (
        <img
          src={src}
          alt={alt || ""}
          className="inline-block max-h-40 max-w-[200px] rounded object-contain"
          loading="lazy"
        />
      );
    },

    strong({ children }) {
      return <strong className="font-semibold">{children}</strong>;
    },

    em({ children }) {
      return <em className="italic">{children}</em>;
    },

    del({ children }) {
      return <del className="line-through">{children}</del>;
    },
  };
}

export function MarkdownContent({
  children,
  compact,
  className,
}: MarkdownContentProps) {
  const dark = useDarkMode();
  const components = useMemo(
    () => createComponents(dark, compact),
    [dark, compact],
  );

  return (
    <div
      className={cn(
        "markdown break-words",
        compact && "markdown-compact",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
