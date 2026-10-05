import type { SpeechRule } from '../speechRule.js';

const HORIZONTAL_RULE_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm;
const HEADING_MARK_RE = /^[ \t]*#{1,6}[ \t]+/gm;
const BULLET_RE = /^[ \t]*[-*+][ \t]+/gm;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const BOLD_RE = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;
const ITALIC_RE = /(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g;
/** A line whose last character isn't already a pause: a heading, a list item, a table row turned sentence. */
const LINE_WITHOUT_STOP_RE = /([^\s.!?:;,])[ \t]*$/gm;
const LINE_BREAKS_RE = /\s*\n\s*/g;

/**
 * Strips the Markdown marks a TTS engine would otherwise read aloud or
 * stumble on (#, **, `, bullets, ---), ends every line with a pause, and
 * joins the lines into one. Runs right after markdownTableRule, which still
 * needs the raw table.
 */
export const markdownCleanupRule: SpeechRule = {
  apply: (text) =>
    text
      .replace(HORIZONTAL_RULE_RE, '')
      .replace(HEADING_MARK_RE, '')
      .replace(BULLET_RE, '')
      .replace(INLINE_CODE_RE, '$1')
      .replace(BOLD_RE, '$2')
      .replace(ITALIC_RE, '$1')
      .replace(LINE_WITHOUT_STOP_RE, '$1.')
      .replace(LINE_BREAKS_RE, ' ')
      .trim(),
};
