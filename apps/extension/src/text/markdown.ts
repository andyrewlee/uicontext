import type { ExtractionResult } from "./extraction"

type MarkdownResult = {
  markdown: string
  metadata?: Record<string, string | number>
}

type RedditComment = {
  author: string | null
  body: string
}

type ParsedReddit = {
  comments: RedditComment[]
  title?: string
  url?: string
  subreddit?: string
}

const splitByBlankLines = (input: string): string[] => {
  return input
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

const guessReddit = (text: string): ParsedReddit | null => {
  const segments = splitByBlankLines(text)
  if (segments.length === 0) {
    return null
  }

  const comments: RedditComment[] = []
  segments.forEach((segment) => {
    const authorMatch = /^(?<author>[^\n:]{1,50}):\s*(?<body>[\s\S]+)/.exec(segment)
    if (authorMatch && authorMatch.groups) {
      const author = authorMatch.groups.author.trim()
      const body = authorMatch.groups.body.trim()
      if (body) {
        comments.push({ author, body })
      }
    } else if (segment.length > 120) {
      comments.push({ author: null, body: segment })
    }
  })

  if (comments.length === 0) {
    return null
  }

  return {
    comments,
  }
}

const redditMarkdown = (parsed: ParsedReddit): MarkdownResult => {
  const lines: string[] = []
  lines.push("# Reddit Thread")
  lines.push("")

  parsed.comments.forEach(({ author, body }, index) => {
    const heading = author ? `## ${author}` : `## Comment ${index + 1}`
    lines.push(heading)
    lines.push("")
    lines.push(body)
    lines.push("")
  })

  return {
    markdown: lines.join("\n").trim(),
  }
}

const guessHackerNews = (text: string): string[] | null => {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  const hasRankedLines = lines.some((line) => /^\d+\.\s+/.test(line))
  if (!hasRankedLines) {
    return null
  }

  return lines
}

const hackerNewsMarkdown = (lines: string[]): MarkdownResult => {
  const listItems = lines.map((line) => {
    if (/^\d+\.\s+/.test(line)) {
      return `1. ${line.replace(/^\d+\.\s+/, "")}`
    }
    return `- ${line}`
  })

  return {
    markdown: ["# Hacker News Snapshot", "", ...listItems].join("\n").trim(),
  }
}

const plainMarkdown = (text: string): MarkdownResult => ({
  markdown: text,
})

export const buildMarkdown = (text: string, extraction: ExtractionResult): MarkdownResult => {
  if (!text.trim()) {
    return { markdown: "" }
  }

  const redditParsed = guessReddit(text)
  if (redditParsed) {
    return redditMarkdown(redditParsed)
  }

  const hnLines = guessHackerNews(text)
  if (hnLines) {
    return hackerNewsMarkdown(hnLines)
  }

  return plainMarkdown(text)
}

export type { MarkdownResult }
