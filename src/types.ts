export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface ResearchFinding {
  timestamp: string;
  query: string;
  title: string;
  url: string;
  content: string;
  relevanceScore: number;
  bot: string;
}

export interface RunResponse {
  status: 'ok' | 'error';
  message: string;
  findingsStored: number;
  prUrl?: string;
}
