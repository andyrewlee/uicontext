"use client";

import { useCallback, useMemo, useState } from "react";

type ContextCopyData = {
  aiPrompt?: string | null;
  aiResponse?: string | null;
  html?: string | null;
  styles?: Record<string, string> | null;
  cssTokens?: Record<string, string> | null;
  textContent?: string | null;
  screenshotUrl?: string | null;
  type: "design" | "text";
};

const createStylesBundle = (
  styles?: Record<string, string> | null,
  cssTokens?: Record<string, string> | null,
) => {
  const styleEntries = styles ? Object.entries(styles) : [];
  const tokenEntries = cssTokens ? Object.entries(cssTokens) : [];

  const styleSection =
    styleEntries.length > 0
      ? styleEntries
          .map(([key, value]) => `${key}: ${value};`)
          .join("\n")
      : "/* no computed styles captured */";

  const tokenSection =
    tokenEntries.length > 0
      ? tokenEntries
          .map(([key, value]) => `${key}: ${value};`)
          .join("\n")
      : "/* no CSS custom properties captured */";

  return `/* Computed styles */\n${styleSection}\n\n/* CSS custom properties */\n${tokenSection}\n`;
};

const buildHtmlBundle = (context: ContextCopyData) => {
  const snippet = context.html ?? "<!-- no HTML captured -->";
  const styles = createStylesBundle(context.styles, context.cssTokens);
  const text = context.textContent ? `\n<!-- text content -->\n${context.textContent}\n` : "";

  return `<!-- Captured HTML snippet -->\n${snippet}\n\n${styles}${text}`;
};

type CopyButtonProps = {
  label: string;
  payload: string | null;
  disabled?: boolean;
};

const CopyButton = ({ label, payload, disabled }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  const isDisabled = Boolean(disabled) || payload == null;

  const handleCopy = useCallback(async () => {
    if (payload == null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error("Failed to copy payload", error);
    }
  }, [payload]);

  return (
    <button
      type="button"
      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      onClick={() => void handleCopy()}
      disabled={isDisabled}
    >
      {copied ? "Copied!" : label}
    </button>
  );
};

type ContextCopyButtonsProps = {
  context: ContextCopyData;
};

export const ContextCopyButtons = ({ context }: ContextCopyButtonsProps) => {
  const htmlBundle = useMemo(() => buildHtmlBundle(context), [context]);

  const promptPayload = context.aiPrompt ?? null;
  const responsePayload = context.aiResponse ?? null;
  const screenshotPayload = context.screenshotUrl ?? null;

  return (
    <div className="flex flex-wrap gap-2">
      <CopyButton label="Copy AI Prompt" payload={promptPayload} disabled={promptPayload == null} />
      <CopyButton
        label="Copy AI Output"
        payload={responsePayload}
        disabled={responsePayload == null}
      />
      <CopyButton label="Copy HTML + Styles" payload={htmlBundle} />
      <CopyButton
        label="Copy Screenshot URL"
        payload={screenshotPayload}
        disabled={screenshotPayload == null}
      />
    </div>
  );
};

export type { ContextCopyData };
