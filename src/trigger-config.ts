export interface ProactiveSettings {
  enabled: boolean;
  groupIds: string[];
  activeSeconds: number;
  idleSeconds: number;
  idleMessages: number;
  historyMessages: number;
  maxRepliesPerMinute: number;
}
export const proactiveDefaults: ProactiveSettings = {
  enabled: false, groupIds: [], activeSeconds: 180, idleSeconds: 5,
  idleMessages: 5, historyMessages: 30, maxRepliesPerMinute: 6,
};
export const proactiveSchema = {
  type: 'object', additionalProperties: false, required: Object.keys(proactiveDefaults), properties: {
    enabled: { type: 'boolean' },
    groupIds: { type: 'array', maxItems: 1000, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 512 } },
    activeSeconds: { type: 'integer', minimum: 10, maximum: 1800 },
    idleSeconds: { type: 'integer', minimum: 1, maximum: 60 },
    idleMessages: { type: 'integer', minimum: 1, maximum: 50 },
    historyMessages: { type: 'integer', minimum: 5, maximum: 100 },
    maxRepliesPerMinute: { type: 'integer', minimum: 1, maximum: 30 },
  },
};
