import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Tokenizer } from '@huggingface/tokenizers';
import type { Config } from './config.js';

let tokenizer: Tokenizer | undefined;
export function textTokens(text: string): number {
  tokenizer ??= new Tokenizer(
    JSON.parse(gunzipSync(readFileSync(new URL('../../assets/deepseek-tokenizer/tokenizer.json.gz', import.meta.url))).toString()),
    JSON.parse(readFileSync(new URL('../../assets/deepseek-tokenizer/tokenizer_config.json', import.meta.url), 'utf8')),
  );
  return tokenizer.encode(text, { add_special_tokens: false }).ids.length;
}

/** Count text locally; reserve the documented maximum of 1024 tokens for each image.
 * JSON framing plus an additional request reserve accounts for unpublished API chat framing.
 * The provider's usage remains authoritative, particularly if its model alias changes.
 */
export function contextSize(value: unknown, limits: Config['limits']): number {
  let images = 0;
  const text = JSON.stringify(value, (key, item: unknown) => {
    if (key !== 'images') return item;
    if (Array.isArray(item)) images += item.length;
    return undefined;
  });
  return limits.contextTokens === undefined ? text.length : textTokens(text) + images * 1024;
}

export function inputBudget(config: Config): number {
  // Leave room for the next generated response, one tool result and chat protocol framing.
  return config.limits.contextTokens === undefined ? config.limits.contextChars!
    : config.limits.contextTokens - config.model.maxOutputTokens - config.limits.toolResultChars - 512;
}
