import { QdrantClient } from '@qdrant/js-client-rest';
import { pipeline } from '@xenova/transformers';
import { ResearchFinding } from './types.js';

const COLLECTION = 'researcher_logs';
const VECTOR_SIZE = 384;
const SIMILARITY_THRESHOLD = 0.95;

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL ?? '',
  apiKey: process.env.QDRANT_API_KEY ?? '',
});

type EmbeddingPipeline = Awaited<ReturnType<typeof pipeline>>;
let embeddingPipeline: EmbeddingPipeline | null = null;

async function getEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    console.log('[Researcher] Loading embedding model...');
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: false }
    );
    console.log('[Researcher] Embedding model loaded');
  }

  const pipe = embeddingPipeline;
  // Cast to any to bypass @xenova/transformers strict overload types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await (pipe as any)(text, { pooling: 'mean', normalize: true });
  const data = output.data as Float32Array;
  return Array.from(data);
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
      console.log(`[Researcher] Duplicate detected (score > ${SIMILARITY_THRESHOLD}) — skipping: "${text.slice(0, 60)}..."`);
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
    points: [
      {
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
      },
    ],
  });

  console.log(`[Researcher] Stored finding: "${finding.title.slice(0, 60)}"`);
  return true;
}
