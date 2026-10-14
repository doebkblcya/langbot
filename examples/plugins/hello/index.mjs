// No framework copy or runtime dependency is required: Cordis supplies the context.
export const name = 'xiaolang-hello';
export const inject = ['tools'];
export const xiaolangApiVersion = 1;

export function apply(ctx, config) {
  const greeting = config.greeting ?? '你好';
  if (typeof greeting !== 'string' || greeting.length > 100) throw new Error('invalid greeting');
  ctx.effect(() => ctx.tools.register({
    name: 'greet',
    description: '向指定名字问好。',
    effect: 'read',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
      required: ['name'],
      additionalProperties: false,
    },
    execute: async ({ name }) => `${greeting}，${name}。`,
  }));
}
