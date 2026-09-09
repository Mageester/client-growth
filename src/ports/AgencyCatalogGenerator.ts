export interface AgencyCatalogGenerationPage {
  url: string;
  title: string;
  headings: string[];
  textExcerpt: string;
}

export interface AgencyCatalogGenerationInput {
  summary: string;
  pages: AgencyCatalogGenerationPage[];
}

export interface AgencyCatalogDraftItem {
  name: string;
  description: string;
  sourceKind: "website" | "summary" | "both";
  sourceUrls: string[];
}

export interface AgencyCatalogGenerator {
  generate(input: AgencyCatalogGenerationInput): Promise<AgencyCatalogDraftItem[]>;
}
