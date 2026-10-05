/**
 * One written-to-spoken rewrite: finds a single format in the text (a
 * table, a date, a dollar amount…) and replaces it with the words a TTS
 * engine should say. Text the rule doesn't recognize must come back untouched.
 */
export interface SpeechRule {
  apply(text: string): string;
}
