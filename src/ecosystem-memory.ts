import { QdrantClient } from '@qdrant/js-client-rest';

const COLLECTION = 'ecosystem_memory';
const VECTOR_SIZE = 384;
const EMBEDDER_URL = process.env.EMBEDDER_URL!;

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL ?? '',
  apiKey: process.env.QDRANT_API_KEY ?? '',
});

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${EMBEDDER_URL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedder returned ${response.status}: ${body}`);
  }
  const result = await response.json() as { vector: number[] };
  if (!Array.isArray(result.vector) || result.vector.length !== 384) {
    throw new Error(`Embedder returned invalid vector length: ${result.vector?.length}`);
  }
  return result.vector;
}

export interface EcosystemEntry {
  bot: 'researcher' | 'coordinator' | 'qa' | 'coder';
  type: string;
  title: string;
  content: string;
  url?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export async function writeToEcosystem(entry: EcosystemEntry): Promise<void> {
  const text = `${entry.title} ${entry.content}`;
  let vector: number[];
  try {
    vector = await getEmbedding(text);
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.warn(`[Ecosystem] Embedding failed — skipping write: ${e.message}`);
    return;
  }

  const id = Date.now();
  await qdrant.upsert(COLLECTION, {
    points: [{
      id,
      vector,
      payload: {
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString(),
      },
    }],
  });
  console.log(`[Ecosystem] Written — bot=${entry.bot} type=${entry.type} title="${entry.title.slice(0, 60)}"`);
}
