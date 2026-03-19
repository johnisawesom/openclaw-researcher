import { TavilyResult } from './types.js';

const TAVILY_API_URL = 'https://api.tavily.com/search';

const WEEKLY_QUERIES = [
  'new AI coding tools 2026',
  'LLM model releases this week',
  'vector database memory techniques AI agents',
];

async function searchTavily(query: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY environment variable not set');
  }

  console.log(`[Tavily] Searching: "${query}"`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      results: Array<{
        title: string;
        url: string;
        content: string;
        score: number;
      }>;
    };

    console.log(`[Tavily] Found ${data.results.length} results for "${query}"`);
    return data.results.map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));

  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Tavily search timed out for query: "${query}"`);
    }
    throw err;
  }
}

export async function runWeeklyResearch(): Promise<Map<string, TavilyResult[]>> {
  const results = new Map<string, TavilyResult[]>();

  for (const query of WEEKLY_QUERIES) {
    try {
      const findings = await searchTavily(query);
      results.set(query, findings);
      // Polite delay between queries
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`[Tavily] Failed for query "${query}": ${e.message}`);
      results.set(query, []);
    }
  }

  return results;
}
