type ExtractionStrategy =
  | "dom_tree_walker"
  | "inner_text"
  | "text_content";

type ExtractionResult = {
  text: string;
  strategy: ExtractionStrategy;
  adapter?: string;
};

const BLOCK_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "div",
  "dd",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "form",
  "header",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const isElementHidden = (element: Element): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.hidden) {
    return true;
  }

  const ariaHidden = element.getAttribute("aria-hidden");
  if (ariaHidden === "true") {
    return true;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return true;
  }

  return false;
};

const isNodeVisible = (node: Node): boolean => {
  let current: Node | null = node.parentNode;
  while (current && current instanceof Element) {
    if (isElementHidden(current)) {
      return false;
    }
    current = current.parentNode;
  }
  return true;
};

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

const findBlockAncestor = (node: Node, root: Element): Element | null => {
  let current = node.parentElement;
  while (current && current !== root) {
    if (BLOCK_TAGS.has(current.tagName.toLowerCase())) {
      return current;
    }
    current = current.parentElement;
  }
  return current ?? root;
};

const hasExplicitLineBreakBefore = (node: Text, root: Element): boolean => {
  let current: Node | null = node;

  while (current && current !== root) {
    let sibling: Node | null = current.previousSibling;

    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE) {
        const element = sibling as Element;
        if (element.tagName.toLowerCase() === "br") {
          return true;
        }

        const text = normalizeWhitespace(element.textContent ?? "");
        if (text) {
          return false;
        }
      } else if (sibling.nodeType === Node.TEXT_NODE) {
        const text = normalizeWhitespace(sibling.textContent ?? "");
        if (text) {
          return false;
        }
      }

      sibling = sibling.previousSibling;
    }

    current = current.parentNode;
  }

  return false;
};

const extractWithTreeWalker = (root: Element): string => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.nodeValue || !normalizeWhitespace(node.nodeValue)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!isNodeVisible(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  type Segment = {
    text: string;
    blockTag: string | null;
    listInfo?: {
      depth: number;
      ordered: boolean;
      index: number | null;
    };
  };

  const segments: Segment[] = [];
  let currentBuffer = "";
  let currentBlock: Element | null = null;

  const computeListInfo = (block: Element): Segment["listInfo"] => {
    if (block.tagName.toLowerCase() !== "li") {
      return undefined;
    }

    let depth = 0;
    let ordered = false;
    const parent = block.parentElement;

    let ancestor: Element | null = parent;
    while (ancestor && ancestor !== root) {
      const tag = ancestor.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        depth += 1;
        if (!ordered && tag === "ol" && ancestor === parent) {
          ordered = true;
        }
      }
      ancestor = ancestor.parentElement;
    }

    if (depth === 0) {
      depth = 1;
    }

    let index: number | null = null;
    if (parent && parent.tagName.toLowerCase() === "ol") {
      const siblings = Array.from(parent.children).filter(
        (child): child is Element => child instanceof Element && child.tagName.toLowerCase() === "li",
      );
      const position = siblings.indexOf(block);
      index = position >= 0 ? position + 1 : null;
    }

    return {
      depth,
      ordered,
      index,
    };
  };

  const flush = () => {
    const trimmed = currentBuffer.trim();
    if (!trimmed) {
      currentBuffer = "";
      return;
    }

    const normalized = trimmed
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n");

    const segment: Segment = {
      text: normalized,
      blockTag: currentBlock?.tagName?.toLowerCase() ?? null,
    };

    if (currentBlock) {
      const listInfo = computeListInfo(currentBlock);
      if (listInfo) {
        segment.listInfo = listInfo;
      }
    }

    segments.push(segment);
    currentBuffer = "";
  };

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = normalizeWhitespace(node.nodeValue ?? "");
    if (!text) {
      continue;
    }

    const block = findBlockAncestor(node, root);
    if (block !== currentBlock) {
      flush();
      currentBlock = block;
    } else if (hasExplicitLineBreakBefore(node, root)) {
      currentBuffer = currentBuffer.replace(/[ \t]+$/, "");
      if (!currentBuffer.endsWith("\n")) {
        currentBuffer += "\n";
      }
    }

    if (
      currentBuffer.length > 0 &&
      !currentBuffer.endsWith("\n") &&
      !currentBuffer.endsWith(" ")
    ) {
      currentBuffer += " ";
    }

    currentBuffer += text;
  }

  flush();

  const formatSegment = (segment: Segment): string => {
    const { blockTag, text, listInfo } = segment;
    if (!blockTag) {
      return text;
    }

    switch (blockTag) {
      case "h1":
        return text.startsWith("# ") ? text : `# ${text}`;
      case "h2":
        return text.startsWith("## ") ? text : `## ${text}`;
      case "h3":
        return text.startsWith("### ") ? text : `### ${text}`;
      case "h4":
        return text.startsWith("#### ") ? text : `#### ${text}`;
      case "h5":
        return text.startsWith("##### ") ? text : `##### ${text}`;
      case "h6":
        return text.startsWith("###### ") ? text : `###### ${text}`;
      case "blockquote": {
        const lines = text.split("\n");
        return lines
          .map((line) => (line.startsWith("> ") ? line : `> ${line}`))
          .join("\n");
      }
      case "pre":
      case "code": {
        const fence = text.includes("```") ? "~~~" : "```";
        return `${fence}\n${text}\n${fence}`;
      }
      case "dt":
        return `**${text}**`;
      case "dd":
        return text;
      case "li": {
        const depth = Math.max(1, listInfo?.depth ?? 1);
        const indent = depth > 1 ? "  ".repeat(depth - 1) : "";
        if (listInfo?.ordered) {
          const marker = listInfo.index ?? 1;
          return `${indent}${marker}. ${text}`;
        }
        return `${indent}- ${text}`;
      }
      default:
        return text;
    }
  };

  const shouldInsertBlankLine = (
    previous: Segment | undefined,
    next: Segment,
  ): boolean => {
    if (!previous) {
      return false;
    }

    if (previous.blockTag === "li" && next.blockTag === "li") {
      const previousDepth = previous.listInfo?.depth ?? 1;
      const nextDepth = next.listInfo?.depth ?? 1;
      return previousDepth !== nextDepth;
    }

    if (previous.blockTag === "blockquote" && next.blockTag === "blockquote") {
      return false;
    }

    return true;
  };

  const output: string[] = [];
  segments.forEach((segment, index) => {
    const formatted = formatSegment(segment).trimEnd();
    if (!formatted) {
      return;
    }

    const previous = segments[index - 1];
    if (output.length > 0 && shouldInsertBlankLine(previous, segment)) {
      output.push("");
    }

    output.push(formatted);
  });

  return output.join("\n");
};

export const extractTextContent = (root: Element): ExtractionResult => {
  const walkerText = extractWithTreeWalker(root);
  if (walkerText.trim()) {
    return {
      text: walkerText,
      strategy: "dom_tree_walker",
    };
  }

  if (root instanceof HTMLElement) {
    const innerText = normalizeWhitespace(root.innerText ?? "");
    if (innerText) {
      return {
        text: innerText,
        strategy: "inner_text",
      };
    }
  }

  const fallback = normalizeWhitespace(root.textContent ?? "");
  return {
    text: fallback,
    strategy: "text_content",
  };
};

export type { ExtractionResult, ExtractionStrategy };
