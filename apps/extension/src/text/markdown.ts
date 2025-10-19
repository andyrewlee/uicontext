import type { ExtractionResult } from "./extraction"

type MarkdownResult = {
  markdown: string
  metadata?: Record<string, string | number>
}

const collapseWhitespace = (input: string): string => {
  const normalized = input
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")

  return normalized
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "")
}

const normalizeListMarkers = (input: string): string => {
  const bulletChars = new Set(["•", "‣", "∙", "▪", "‒", "–", "—", "·", "○", "●", "◦"])

  const lines = input.split("\n")
  return lines
    .map((line) => {
      const trimmedStart = line.trimStart()
      const leading = line.slice(0, line.length - trimmedStart.length)

      if (trimmedStart.length === 0) {
        return ""
      }

      if (/^[-*+]\s+/.test(trimmedStart)) {
        const content = trimmedStart.replace(/^[-*+]\s+/, "").trimStart()
        return `${leading}- ${content}`
      }

      const firstChar = trimmedStart[0]
      if (bulletChars.has(firstChar)) {
        const rest = trimmedStart.slice(1).trimStart()
        return `${leading}- ${rest}`
      }

      const orderedMatch = /^(\d+)[\)\.:\-]?\s+(.*)$/.exec(trimmedStart)
      if (orderedMatch) {
        const [, index, rest] = orderedMatch
        return `${leading}${index}. ${rest.trim()}`
      }

      return line
    })
    .join("\n")
}

const emphasizeStandaloneLines = (input: string): string => {
  const lines = input.split("\n")

  return lines
    .map((line, index) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return line
      }

      const previous = index > 0 ? lines[index - 1].trim() : ""
      const next = index < lines.length - 1 ? lines[index + 1].trim() : ""

      const isIsolated = !previous && !next
      const isHeadingCandidate =
        trimmed.length > 0 &&
        trimmed.length <= 60 &&
        /[A-Za-z]/.test(trimmed) &&
        /^[A-Z0-9 \-–—:&'"()]+$/.test(trimmed)

      if (isIsolated && isHeadingCandidate && !trimmed.startsWith("#")) {
        return `## ${trimmed}`
      }

      return line
    })
    .join("\n")
}

const buildGenericMarkdown = (text: string): string => {
  const withLists = normalizeListMarkers(text)
  const withHeadings = emphasizeStandaloneLines(withLists)
  return collapseWhitespace(withHeadings)
}

export const buildMarkdown = (text: string, extraction: ExtractionResult): MarkdownResult => {
  const trimmed = text.trim()
  if (!trimmed) {
    return { markdown: "" }
  }
  void extraction

  return {
    markdown: buildGenericMarkdown(trimmed),
  }
}

export type { MarkdownResult }
