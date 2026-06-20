import { jsonSchema, tool } from "ai";
import type { Tool } from "ai";

export const toolSchemas: Record<
  string,
  { description: string; schema: Record<string, unknown> }
> = {
  getMarketIndex: {
    description: "获取 CS2 饰品市场大盘指数和近 10 个历史点，用于判断整体走势。",
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  searchItems: {
    description: "按关键词搜索 CS2 饰品目录，返回 name 和 marketHashName。",
    schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "饰品中文名或 market hash name 关键词" },
      },
      required: ["keyword"],
      additionalProperties: false,
    },
  },
  getHotList: {
    description: "获取热门饰品榜单，含各平台最低价、最高价和跨平台价差百分比。",
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  getItemPrice: {
    description: "查询指定饰品在悠悠有品/BUFF/C5/Steam 等平台的实时价格。",
    schema: {
      type: "object",
      properties: {
        marketHashName: { type: "string", description: "饰品的 market hash name" },
      },
      required: ["marketHashName"],
      additionalProperties: false,
    },
  },
  getItemKline: {
    description: "查询指定饰品的 K 线数据（日/周/月），用于走势分析。",
    schema: {
      type: "object",
      properties: {
        marketHashName: { type: "string", description: "饰品的 market hash name" },
        platform: { type: "string", description: "平台代码，如 YOUPIN/BUFF/C5/STEAM，默认 YOUPIN" },
        klineType: { type: "string", description: "K 线类型：1=日，2=周，3=月，默认 1" },
      },
      required: ["marketHashName"],
      additionalProperties: false,
    },
  },
  compareItems: {
    description: "对比 2~3 个 CS2 饰品的多平台价格，输出最低价、最高价和跨平台价差。",
    schema: {
      type: "object",
      properties: {
        marketHashNames: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 3,
          description: "要对比的饰品 market hash name 列表",
        },
      },
      required: ["marketHashNames"],
      additionalProperties: false,
    },
  },
  getItemHistory: {
    description: "获取饰品 K 线并计算趋势摘要（MA5/MA10/波动率）。",
    schema: {
      type: "object",
      properties: {
        marketHashName: { type: "string", description: "饰品的 market hash name" },
        platform: { type: "string", description: "平台代码，默认 YOUPIN" },
        klineType: { type: "string", description: "K 线类型：1=日，2=周，3=月，默认 1" },
      },
      required: ["marketHashName"],
      additionalProperties: false,
    },
  },
  analyzePortfolio: {
    description: "根据持有的饰品列表与买入价，计算总市值、浮动盈亏和集中度。",
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              marketHashName: { type: "string" },
              quantity: { type: "number", default: 1 },
              avgBuyPrice: { type: "number", description: "平均买入价（可选）" },
            },
            required: ["marketHashName"],
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  getSteamInventory: {
    description: "查询指定 Steam 用户的 CS2 库存列表（需后端支持 Steam 库存代理）。",
    schema: {
      type: "object",
      properties: {
        steamId: { type: "string", description: "Steam ID64 或自定义 URL" },
        gameAppId: { type: "string", description: "游戏 AppID，默认 730" },
      },
      required: ["steamId"],
      additionalProperties: false,
    },
  },
  sendChannelMessage: {
    description: "在当前 TeamSpeak 频道发送一条文字消息。",
    schema: {
      type: "object",
      properties: { message: { type: "string", description: "要发送的消息内容" } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  sendServerMessage: {
    description: "向整个 TeamSpeak 服务器发送一条文字消息。",
    schema: {
      type: "object",
      properties: { message: { type: "string", description: "要发送的消息内容" } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  sendPrivateMessage: {
    description: "向指定在线用户发送一条私信。",
    schema: {
      type: "object",
      properties: {
        clientName: { type: "string", description: "目标用户昵称或昵称片段" },
        message: { type: "string", description: "私信内容" },
      },
      required: ["clientName", "message"],
      additionalProperties: false,
    },
  },
  pokeClient: {
    description: "戳一下指定 TeamSpeak 用户（对方会收到弹窗提醒）。",
    schema: {
      type: "object",
      properties: {
        clientName: { type: "string", description: "目标用户昵称或昵称片段" },
        message: { type: "string", description: "戳人时附带的简短消息" },
      },
      required: ["clientName"],
      additionalProperties: false,
    },
  },
  listChannels: {
    description: "列出当前 TeamSpeak 服务器的所有频道。",
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  listOnlineClients: {
    description: "列出当前 TeamSpeak 服务器所有在线用户及所在频道。",
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
};

/// AI SDK ToolSet used by `convertToModelMessages` to understand tool calls.
export const AGENT_TOOLS: Record<string, Tool> = Object.fromEntries(
  Object.entries(toolSchemas).map(([name, { description, schema }]) => [
    name,
    tool({ description, inputSchema: jsonSchema(schema) }),
  ]),
);

/// OpenAI-compatible tool definitions forwarded to the Worker/EvoMap.
export const OPENAI_TOOLS = Object.entries(toolSchemas).map(([name, { description, schema }]) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: schema,
  },
}));
