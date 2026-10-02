export const DocumentStatus = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;

export type DocumentStatus =
  (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const DocumentType = {
  POLICIES: "POLICIES", // should be injected in system prompts
  DATA: "DATA",
  REPORTS: "REPORTS",
  TRANSCRIPT: "TRANSCRIPT",
  FAQ: "FAQ",
  EMAIL: "EMAIL",
} as const;

export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const DocumentFormat = {
  MARKDOWN: "MARKDOWN",
  JSON: "JSON",
  CSV: "CSV",
  HTML: "HTML",
  TEXT: "TEXT",
} as const;

export type DocumentFormat =
  (typeof DocumentFormat)[keyof typeof DocumentFormat];

export interface ArchitectureDocument {
  id: string;

  title: string;
  type: DocumentType;
  format: DocumentFormat;

  status: DocumentStatus;

  effectiveDate?: Date;
  expirationDate?: Date;

  tags: string[];

  content: string;

  createdAt: Date;
  updatedAt: Date;
}
