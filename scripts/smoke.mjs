/**
 * 真实账号联调脚本。
 *
 * 凭据只从环境变量读，**永不写入仓库**；输出里所有 Key/凭据都已脱敏。
 *
 * ```bash
 * export QINIU_ACCESS_KEY=...
 * export QINIU_SECRET_KEY=...
 * node scripts/smoke.mjs                       # 默认查昨天
 * node scripts/smoke.mjs --day today
 * node scripts/smoke.mjs --day 2026-01-01 --key 我的测试Key
 * node scripts/smoke.mjs --json                # 输出原始载荷
 * ```
 *
 * 这个脚本 import 的是 `src/` 下的 TS 源码 —— Node 24 原生支持直接运行 TS，
 * 因此不依赖构建产物（但 `lib/` 存在时也没问题）。
 *
 * @module dsh-qiniu-usage/scripts/smoke
 */

import { CredentialAccess } from '../src/credentials.ts'
import { resolveConfig } from '../src/config.ts'
import { QiniuUsageService } from '../src/service.ts'

/** 解析简单的位置无关参数。 */
function parseArgs(argv) {
  const args = { day: 'yesterday', key: '', json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--day') args.day = argv[++index] ?? 'yesterday'
    else if (token === '--key') args.key = argv[++index] ?? ''
    else if (token === '--json') args.json = true
    else if (token === '--help' || token === '-h') args.help = true
  }
  return args
}

/** Token 数量的紧凑显示。 */
function fmt(value) {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1e6) return `${Number((value / 1e6).toFixed(2))}M`
  if (Math.abs(value) >= 1e3) return `${Number((value / 1e3).toFixed(2))}K`
  return String(Math.round(value))
}

const args = parseArgs(process.argv.slice(2))
if (args.help === true) {
  console.log(`用法：node scripts/smoke.mjs [--day today|yesterday|YYYY-MM-DD] [--key <label>] [--json]`)
  process.exit(0)
}

const accessKeyRef = process.env.QINIU_ACCESS_KEY_REF ?? 'QINIU_ACCESS_KEY'
const secretKeyRef = process.env.QINIU_SECRET_KEY_REF ?? 'QINIU_SECRET_KEY'

if (process.env[accessKeyRef] === undefined || process.env[accessKeyRef] === '') {
  console.error(`缺少环境变量 ${accessKeyRef}。请先 export 后再运行；本脚本不会读取任何文件凭据。`)
  process.exit(2)
}
if (process.env[secretKeyRef] === undefined || process.env[secretKeyRef] === '') {
  console.error(`缺少环境变量 ${secretKeyRef}。`)
  process.exit(2)
}

// 直接走环境变量来源（与宿主在"无凭据库"时的降级路径完全一致）。
const credentials = new CredentialAccess(undefined, process.env)
const service = new QiniuUsageService({
  config: resolveConfig({ accessKeyRef, secretKeyRef }),
  credentials,
})

console.log(`查询 ${args.day}${args.key === '' ? '（全部 Key 汇总）' : `，Key=${args.key}`} …\n`)

const payload = await service.overview(args.day, args.key)

if (args.json === true) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(payload.ok ? 0 : 1)
}

if (payload.usage !== null) {
  const usage = payload.usage
  console.log(`── 用量（${usage.granularity} 粒度，${usage.range.start} → ${usage.range.end}）`)
  console.log(`   Key: ${usage.keyLabel}${usage.keyMasked === '' ? '' : ` (${usage.keyMasked})`}`)
  if (usage.watermark !== undefined) console.log(`   水位线: ${usage.watermark}`)
  for (const model of usage.models) {
    console.log(
      `   ${model.name.padEnd(28)} 输入 ${fmt(model.totalsByKind.input).padStart(8)}`
      + `  输出 ${fmt(model.totalsByKind.output).padStart(8)}`
      + `  合计 ${fmt(model.total).padStart(8)}`,
    )
  }
  console.log(`   合计 ${fmt(usage.totals.total)} tokens · ${usage.models.length} 个模型`)
  for (const warning of usage.warnings) console.log(`   ⚠ ${warning}`)
} else {
  console.log('── 用量：未取到')
}

if (payload.respack !== null) {
  const respack = payload.respack
  console.log('\n── 资源包当月口径')
  for (const item of respack.items) {
    console.log(
      `   ${item.itemName}${item.zoneName === '' ? '' : ` / ${item.zoneName}`}`
      + `  可用 ${item.monthCapacity} ${item.unit}`
      + `  已用 ${item.monthUsed}`
      + `  剩余 ${item.monthRemain}`
      + `  利用率 ${Math.round(item.utilization * 100)}%`,
    )
  }
  console.log('\n── 资源包逐包（生命周期口径）')
  for (const pack of respack.packages) {
    console.log(
      `   ${pack.name}  [${pack.statusLabel}]`
      + `  ${pack.usedAmount}/${pack.totalAmount} ${pack.unit}`
      + `  ${pack.daysRemaining === undefined ? '' : `${pack.daysRemaining} 天后到期`}`,
    )
  }
  for (const warning of respack.warnings) console.log(`   ⚠ ${warning}`)
} else {
  console.log('\n── 资源包：未取到')
}

if (payload.errors.length > 0) {
  console.log('\n── 错误')
  for (const error of payload.errors) {
    console.log(
      `   [${error.source}]${error.code === undefined ? '' : ` code=${error.code}`} ${error.message}`,
    )
  }
}

process.exit(payload.ok ? 0 : 1)
