import { QdrantClient } from '@qdrant/js-client-rest';
import { ResearchFinding } from './types.js';
import { writeToEcosystem } from './ecosystem-memory.js';

const COLLECTION = 'researcher_logs';
const VECTOR_SIZE = 384;
const SIMILARITY_THRESHOLD = 0.95;
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

async function ensureCollection(): Promise<void> {
  try {
    await qdrant.getCollection(COLLECTION);
    console.log(`[Researcher] Collection ${COLLECTION} exists`);
  } catch {
    console.log(`[Researcher] Creating collection ${COLLECTION}...`);
    await qdrant.createCollection(COLLECTION, {
      vectors: {
        size: VECTOR_SIZE,
        distance: 'Cosine',
      },
    });
    console.log(`[Researcher] Collection ${COLLECTION} created`);
  }

  try {
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: 'timestamp',
      field_schema: 'keyword',
    });
    console.log(`[Researcher] Payload index on timestamp confirmed`);
  } catch {
    console.log(`[Researcher] Payload index on timestamp already exists -- skipping`);
  }
}

async function isDuplicate(embedding: number[], text: string): Promise<boolean> {
  try {
    const results = await qdrant.search(COLLECTION, {
      vector: embedding,
      limit: 1,
      score_threshold: SIMILARITY_THRESHOLD,
      with_payload: false,
    });
    if (results.length > 0) {
      console.log(`[Researcher] Duplicate detected (score > ${SIMILARITY_THRESHOLD}) -- skipping: "${text.slice(0, 60)}..."`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function initResearcherMemory(): Promise<void> {
  await ensureCollection();
  await getEmbedding('warm up');
  console.log('[Researcher] Memory layer ready');
}

export async function storeFinding(finding: ResearchFinding): Promise<boolean> {
  const text = `${finding.title} ${finding.content}`;
  const embedding = await getEmbedding(text);

  const duplicate = await isDuplicate(embedding, text);
  if (duplicate) return false;

  const id = Date.now();
  await qdrant.upsert(COLLECTION, {
    points: [{
      id,
      vector: Array.from(embedding),
      payload: {
        timestamp: finding.timestamp,
        query: finding.query,
        title: finding.title,
        url: finding.url,
        content: finding.content.slice(0, 500),
        relevanceScore: finding.relevanceScore,
        bot: 'researcher',
      },
    }],
  });

  console.log(`[Researcher] Stored finding: "${finding.title.slice(0, 60)}"`);

  writeToEcosystem({
    bot: 'researcher',
    type: 'ResearchFinding',
    title: finding.title,
    content: finding.content.slice(0, 500),
    url: finding.url,
    timestamp: finding.timestamp,
    metadata: {
      query: finding.query,
      relevanceScore: finding.relevanceScore,
    },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    console.warn(`[Ecosystem] Write failed -- not blocking storeFinding: ${e.message}`);
  });

  return true;
}

export interface StoredFinding {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string;
  relevanceScore: number;
}

export async function searchFindings(
  query: string,
  limit: number = 5,
  maxAgeDays: number = 30
): Promise<StoredFinding[]> {
  console.log(`[Researcher] searchFindings: query="${query.slice(0, 60)}" limit=${limit} maxAgeDays=${maxAgeDays}`);

  const embedding = await getEmbedding(query);
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  const results = await qdrant.search(COLLECTION, {
    vector: embedding,
    limit: limit * 3,
    score_threshold: 0.4,
    with_payload: true,
  });

  const filtered = results.filter((r) => {
    const p = r.payload as Record<string, unknown>;
    const ts = String(p['timestamp'] ?? '');
    return ts >= cutoff;
  });

  const trimmed = filtered.slice(0, limit);
  console.log(`[Researcher] searchFindings: ${results.length} raw results, ${filtered.length} within age window, returning ${trimmed.length}`);

  return trimmed.map((r) => {
    const p = r.payload as Record<string, unknown>;
    return {
      title: String(p['title'] ?? ''),
      url: String(p['url'] ?? ''),
      snippet: String(p['content'] ?? '').slice(0, 300),
      publishedAt: String(p['timestamp'] ?? ''),
      relevanceScore: r.score,
    };
  });
}
