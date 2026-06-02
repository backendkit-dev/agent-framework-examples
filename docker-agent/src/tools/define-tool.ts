import { z } from 'zod';
import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export { z };

type ZodShape = Record<string, z.ZodTypeAny>;

function zodToJsonSchema(shape: ZodShape): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, schema] of Object.entries(shape)) {
    properties[key] = zodFieldToJson(schema);
    if (!(schema instanceof z.ZodOptional) && !(schema instanceof z.ZodDefault)) {
      required.push(key);
    }
  }

  return { type: 'object', properties, required: required.length ? required : undefined };
}

function zodFieldToJson(schema: z.ZodTypeAny): Record<string, unknown> {
  const desc = schema.description ? { description: schema.description } : {};
  if (schema instanceof z.ZodDefault) return { ...zodFieldToJson(schema._def.innerType), ...desc };
  if (schema instanceof z.ZodOptional) return { ...zodFieldToJson(schema._def.innerType), ...desc };
  if (schema instanceof z.ZodString) return { type: 'string', ...desc };
  if (schema instanceof z.ZodNumber) return { type: 'number', ...desc };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean', ...desc };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema._def.values, ...desc };
  if (schema instanceof z.ZodArray) return { type: 'array', items: zodFieldToJson(schema._def.type), ...desc };
  if (schema instanceof z.ZodObject) return zodToJsonSchema(schema._def.shape() as ZodShape);
  if (schema instanceof z.ZodRecord) return { type: 'object', additionalProperties: { type: 'string' }, ...desc };
  return { type: 'string', ...desc };
}

// Non-generic defineTool — avoids deep zod type inference that causes tsc OOM.
// Args are typed as `any` in execute since the schema validates at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineTool(opts: {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: z.ZodObject<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(args: any, ctx: ExecutionContext): Promise<string>;
}): ToolDefinition {
  return {
    name: opts.name,
    description: opts.description,
    parameters: zodToJsonSchema(opts.input._def.shape() as ZodShape),
    execute: async (rawArgs: unknown, ctx: ExecutionContext) => {
      const result = opts.input.safeParse(rawArgs);
      if (!result.success) {
        const issues = result.error.issues.map((i: z.ZodIssue) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
        return `Error: Invalid arguments — ${issues}`;
      }
      return opts.execute(result.data, ctx);
    },
  };
}
