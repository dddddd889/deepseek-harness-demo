import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { Scope } from './scope.mjs'

/** MCP连接是一个代次；断开/替换必须撤销该代次的工具。 */
export async function mountMCP(scope, tools, name, spec) {
  const client = new Client({ name: 'harness-own', version: '0.1.0' })
  const transport = spec.url ? new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers: spec.headers } }) : new StdioClientTransport({ command: spec.command, args: spec.args, env: spec.env })
  const owner = scope.child()
  owner.own(() => client.close())
  let contribution = new Scope(), revision = 0, chain = Promise.resolve()
  owner.own(() => contribution.close())
  try { await client.connect(transport) } catch (error) { await owner.close(); throw error }
  const discover = () => {
    const generation = ++revision
    chain = chain.then(async () => {
      const definitions = []; let cursor
      do { const page = await client.listTools(cursor ? { cursor } : undefined); definitions.push(...page.tools); cursor = page.nextCursor } while (cursor)
      if (generation !== revision || owner.closed) return
      const next = new Scope()
      await contribution.close(); contribution = next
      try {
        for (const definition of definitions) tools.register(next, {
          name: name + '__' + definition.name, description: definition.description ?? '', schema: definition.inputSchema,
          effect: 'network', exclusive: definition.annotations?.readOnlyHint !== true,
          async run(args, context) {
            const result = await client.callTool({ name: definition.name, arguments: args }, undefined, { signal: context.signal })
            if (result.isError) throw Error(JSON.stringify(result.content))
            return result.content
          },
        })
      } catch (error) { await next.close(); throw error }
    })
    return chain
  }
  client.setNotificationHandler(ToolListChangedNotificationSchema, discover)
  try { await discover() } catch (error) { await owner.close(); throw error }
  return { client, refresh: discover, close: () => owner.close(), instructions: client.getInstructions?.() ?? '',
    resources: async () => {
      const values = []; let cursor
      do { const page = await client.listResources(cursor ? { cursor } : undefined); values.push(...page.resources); cursor = page.nextCursor } while (cursor)
      return values
    },
    templates: () => client.listResourceTemplates(), read: uri => client.readResource({ uri }),
  }
}
