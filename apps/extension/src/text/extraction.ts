type ExtractionStrategy =
  | "site_adapter"
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

  const paragraphs: string[] = [];
  let currentBuffer = "";
  let lastBlock: Element | null = null;

  const flush = () => {
    const trimmed = currentBuffer.trim();
    if (!trimmed) {
      currentBuffer = "";
      return;
    }
    paragraphs.push(
      trimmed.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n"),
    );
    currentBuffer = "";
  };

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = normalizeWhitespace(node.nodeValue ?? "");
    if (!text) {
      continue;
    }

    const block = findBlockAncestor(node, root);
    if (block !== lastBlock) {
      flush();
      lastBlock = block;
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

  return paragraphs.join("\n\n");
};

type SiteAdapter = {
  name: string;
  domains: string[];
  extract: (root: Element) => string | null;
};

const redditAdapter: SiteAdapter = {
  name: "reddit",
  domains: ["reddit.com"],
  extract: (root) => {
    const commentBodies = Array.from(
      root.querySelectorAll<HTMLElement>('[data-test-id="comment"]'),
    );

    if (commentBodies.length === 0) {
      return null;
    }

    const segments: string[] = [];

    commentBodies.forEach((comment, index) => {
      const author =
        comment
          .querySelector<HTMLElement>('[data-testid="comment_author_link"]')
          ?.innerText?.trim() ??
        comment
          .querySelector<HTMLElement>('[data-click-id="author"]')
          ?.innerText?.trim() ??
        null;
      const body =
        extractWithTreeWalker(comment.querySelector("[data-test-id=\"comment-content\"]") ?? comment) ||
        normalizeWhitespace(comment.innerText ?? "");

      if (!body) {
        return;
      }

      const lines: string[] = [];
      if (author) {
        lines.push(`${author}:`);
      }
      lines.push(body);

      segments.push(lines.join("\n"));

      if (index < commentBodies.length - 1) {
        segments.push("");
      }
    });

    const result = segments.join("\n");
    return result.trim() ? result : null;
  },
};

const hackerNewsAdapter: SiteAdapter = {
  name: "hacker-news",
  domains: ["news.ycombinator.com"],
  extract: (root) => {
    const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tr"));
    if (rows.length === 0) {
      return null;
    }

    const segments: string[] = [];
    rows.forEach((row) => {
      const titleCell = row.querySelector("td.titleline");
      if (titleCell) {
        const text = normalizeWhitespace(titleCell.innerText ?? "");
        if (text) {
          segments.push(text);
        }
      }

      const commentCell = row.querySelector("td.default");
      if (commentCell) {
        const author =
          commentCell.querySelector<HTMLElement>("a.hnuser")?.innerText?.trim() ??
          null;
        const bodyNode = commentCell.querySelector<HTMLElement>("span.commtext");
        const body = bodyNode
          ? extractWithTreeWalker(bodyNode)
          : normalizeWhitespace(commentCell.innerText ?? "");

        if (body) {
          if (author) {
            segments.push(`${author}:`);
          }
          segments.push(body);
        }
      }
    });

    const result = segments.join("\n\n");
    return result.trim() ? result : null;
  },
};

const twitterAdapter: SiteAdapter = {
  name: "twitter",
  domains: ["twitter.com", "x.com"],
  extract: (root) => {
    const tweetNodes = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid="tweetText"]'),
    );

    if (tweetNodes.length === 0) {
      const fallbackLangNodes = Array.from(
        root.querySelectorAll<HTMLElement>('article [data-testid="tweet"] div[lang]'),
      );
      fallbackLangNodes.forEach((node) => {
        if (!tweetNodes.includes(node)) {
          tweetNodes.push(node);
        }
      });
    }

    if (tweetNodes.length === 0) {
      return null;
    }

    const segments = tweetNodes
      .map((node) => normalizeWhitespace(node.innerText ?? ""))
      .filter((text) => Boolean(text));

    if (segments.length === 0) {
      return null;
    }

    return segments.join("\n\n");
  },
};

const SITE_ADAPTERS: SiteAdapter[] = [redditAdapter, hackerNewsAdapter, twitterAdapter];

const selectAdapter = (hostname: string): SiteAdapter | null => {
  return SITE_ADAPTERS.find((adapter) =>
    adapter.domains.some((domain) => hostname.endsWith(domain)),
  ) ?? null;
};

const trySiteAdapter = (root: Element): ExtractionResult | null => {
  const adapter = selectAdapter(window.location.hostname);
  if (!adapter) {
    return null;
  }

  try {
    const text = adapter.extract(root);
    if (text && text.trim()) {
      return {
        text,
        strategy: "site_adapter",
        adapter: adapter.name,
      };
    }
  } catch {
    return null;
  }

  return null;
};

export const extractTextContent = (root: Element): ExtractionResult => {
  const adapterResult = trySiteAdapter(root);
  if (adapterResult) {
    return adapterResult;
  }

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
