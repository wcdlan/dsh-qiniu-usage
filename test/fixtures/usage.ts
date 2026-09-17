/**
 * 用量响应 fixture —— 覆盖设计文档 §3.1 的三种 `data` 形态。
 *
 * 三者**在语义上等价**：都是 2 个模型、同样的输入/输出量。因此归一测试可以断言
 * "三形态归一结果一致"，这正是 M1 的验收标准。
 *
 * @module dsh-qiniu-usage/test/fixtures/usage
 */

/** 形态 1：Bearer 鉴权 → `data[] = models[]`，item 带 categories 层。 */
export const bearerFlatModels = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    items: [
      {
        name: '输入 Token',
        unit: 'kToken',
        total: 1240,
        categories: [
          {
            name: '输入 Token',
            values: [
              { time: '2026-01-01T00:00:00+08:00', value: 600 },
              { time: '2026-01-01T01:00:00+08:00', value: 640 },
            ],
          },
        ],
      },
      {
        name: '输出 Token',
        unit: 'kToken',
        total: 310,
        categories: [
          {
            name: '输出 Token',
            values: [{ time: '2026-01-01T00:00:00+08:00', value: 310 }],
          },
        ],
      },
    ],
  },
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    items: [
      {
        name: '输入 Token',
        unit: 'kToken',
        total: 420,
        categories: [
          {
            name: '输入 Token',
            values: [{ time: '2026-01-01T00:00:00+08:00', value: 420 }],
          },
        ],
      },
      {
        name: '输出 Token',
        unit: 'kToken',
        total: 110,
        categories: [
          {
            name: '输出 Token',
            values: [{ time: '2026-01-01T00:00:00+08:00', value: 110 }],
          },
        ],
      },
    ],
  },
]

/** 形态 2：AK/SK + RFC3339 → `data[] = { api_key, name, models[] }`。 */
export const akskKeyGroups = [
  {
    api_key: 'abcdefghijklmnop',
    name: '我的测试Key',
    models: bearerFlatModels,
  },
]

/**
 * **当天**的真实形态：上游尚未把用量归属到具体 Key。
 *
 * 实测自真实账号（设计文档 §15.10）：`api_key` 是占位值 `unknown`、`name` 为空串，
 * 全部模型的用量挤在这一个分组里。历史日期才有真实归属。
 */
export const akskUnattributed = [
  {
    api_key: 'unknown',
    name: '',
    models: bearerFlatModels,
  },
]

/** 实时接口真实返回的 Key 掩码格式：上游已脱敏为 `前5位*****后5位`。 */
export const akskMaskedKeys = [
  {
    api_key: 'sk-69*****03bf3',
    name: 'dsh',
    models: bearerFlatModels,
  },
  {
    api_key: 'sk-15*****72ca6',
    name: 'Halo',
    models: bearerFlatModels,
  },
]

/** 形态 2 的第二组 Key：换一个 api_key，模型量更小。 */
export const akskTwoKeys = [
  ...akskKeyGroups,
  {
    api_key: 'zyxwvutsrqponmlk',
    name: '生产Key',
    models: [
      {
        id: 'qwen-max',
        name: 'Qwen Max',
        items: [
          {
            name: '输入 Token',
            unit: 'kToken',
            total: 100,
            categories: [{ name: '输入 Token', values: [{ time: '2026-01-01T00:00:00+08:00', value: 100 }] }],
          },
        ],
      },
    ],
  },
]

/** 形态 3：AK/SK + `YYYY-MM-DD` → `data[] = models[]`，`items[].values[]` 扁平。 */
export const akskFlatDates = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    items: [
      {
        name: '输入 Token',
        unit: 'kToken',
        total: 1240,
        values: [
          { time: '2026-01-01T00:00:00+08:00', value: 600 },
          { time: '2026-01-01T01:00:00+08:00', value: 640 },
        ],
      },
      {
        name: '输出 Token',
        unit: 'kToken',
        total: 310,
        values: [{ time: '2026-01-01T00:00:00+08:00', value: 310 }],
      },
    ],
  },
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    items: [
      {
        name: '输入 Token',
        unit: 'kToken',
        total: 420,
        values: [{ time: '2026-01-01T00:00:00+08:00', value: 420 }],
      },
      {
        name: '输出 Token',
        unit: 'kToken',
        total: 110,
        values: [{ time: '2026-01-01T00:00:00+08:00', value: 110 }],
      },
    ],
  },
]

/** 缓存类计费项：验证归类到 cachedInput / cachedWrite 而不是 input。 */
export const withCacheItems = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    items: [
      { name: '输入 Token', unit: 'kToken', total: 100 },
      { name: '输出 Token', unit: 'kToken', total: 50 },
      { name: '缓存命中 Token', unit: 'kToken', total: 30 },
      { name: '缓存写入 Token', unit: 'kToken', total: 20 },
      { name: '未知计费项 XYZ', unit: 'kToken', total: 7 },
    ],
  },
]
