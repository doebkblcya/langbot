import { Failure, check } from './errors.js';
import { object } from './contracts.js';
import type { MemoryConfig } from './memory-config.js';

export interface Embeddings { embed(texts: string[], signal: AbortSignal): Promise<number[][]> }
export class BailianEmbeddings implements Embeddings {
  constructor(private config: MemoryConfig, private key: string, private fetcher: typeof fetch = fetch) {}
  async embed(texts: string[], signal: AbortSignal): Promise<number[][]> {
    if (!this.key) throw new Failure('embedding_key_missing');
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 10) {
      check(signal);
      const batch = texts.slice(offset, offset + 10).map(text => text.slice(0, 6000));
      let response: Response;
      try { response = await this.fetcher(`${this.config.embeddingBaseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({ model: this.config.embeddingModel, input: batch, dimensions: this.config.embeddingDimensions, encoding_format: 'float' }),
      }); } catch { check(signal); throw new Failure('embedding_network'); }
      if (!response.ok) { await response.body?.cancel(); throw new Failure(`embedding_http_${response.status}`); }
      const data = object(await response.json())?.data;
      if (!Array.isArray(data) || data.length !== batch.length) throw new Failure('embedding_invalid_response');
      const ordered: number[][] = [];
      for (const item of data) {
        const row = object(item), index = row?.index, vector = row?.embedding;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= batch.length || ordered[index]
          || !Array.isArray(vector) || vector.length !== this.config.embeddingDimensions || !vector.every(n => typeof n === 'number' && Number.isFinite(n))
          || !vector.some(n => n !== 0)) throw new Failure('embedding_invalid_response');
        ordered[index] = vector as number[];
      }
      vectors.push(...ordered);
    }
    return vectors;
  }
}
