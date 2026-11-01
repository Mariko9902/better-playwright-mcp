import { zodToJsonSchema } from 'zod-to-json-schema';

export function toMcpTool(tool: any) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema, { strictUnions: true }),
    annotations: {
      title: tool.title,
      readOnlyHint: tool.type === 'readOnly',
      destructiveHint: tool.type === 'destructive',
      openWorldHint: true,
    },
  };
}

export function defineToolSchema(tool: any) {
  return tool;
}
