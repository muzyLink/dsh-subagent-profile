#!/usr/bin/env node
/**
 * dsh-subagent-profile 发布脚本
 *
 * 用法:
 *   node scripts/release.mjs             # 自动升一个 patch(0.1.0 -> 0.1.1)
 *   node scripts/release.mjs 0.2.0       # 指定目标版本
 *   node scripts/release.mjs --dry-run   # 演练:只检查并打印计划,不落任何改动
 *
 * 流程:预检 -> 升版 package.json -> commit -> 打 tag -> push github -> pnpm publish -> 核验 -> 输出 Release Notes 草稿
 *
 * 前提:
 *   - pnpm 已登录,且配置了可发布 npm 的凭证(granular token + Bypass 2FA,
 *     写入 %LOCALAPPDATA%\pnpm\config\auth.ini 或 ~/.npmrc)
 *   - GitHub Release 由脚本输出的草稿在网页上手动发布(或装 gh 后一条命令)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG_PATH = join(ROOT, 'package.json')
const REMOTE = 'github' // 公开发布走 GitHub remote(origin 是内网 Gitea,不推)
const REGISTRY = 'https://registry.npmjs.org'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const versionArg = (args.find((a) => /^v?\d+\.\d+\.\d+/.test(a)) || '').replace(/^v/, '')

const fail = (msg) => {
  console.error('\n✗ ' + msg)
  process.exit(1)
}

/** 真实执行(读操作/预检),失败即退出 */
function sh(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: 'utf8', cwd: ROOT }).trim()
  } catch (e) {
    console.error((e.stderr || e.message).trim())
    fail(`${cmd} ${cmdArgs.join(' ')} 执行失败`)
  }
}

/** 真实执行,失败返回 null(用于「可能不存在」的查询) */
function trySh(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: 'utf8', cwd: ROOT }).trim()
  } catch {
    return null
  }
}

/** 发布动作:dry-run 时只打印,不执行 */
function step(cmd, cmdArgs) {
  console.log(dryRun ? `\n[dry-run] $ ${cmd} ${cmdArgs.join(' ')}` : `\n$ ${cmd} ${cmdArgs.join(' ')}`)
  if (dryRun) return ''
  try {
    const out = execFileSync(cmd, cmdArgs, { encoding: 'utf8', cwd: ROOT })
    if (out.trim()) console.log(out.trim())
    return out.trim()
  } catch (e) {
    console.error((e.stderr || e.message).trim())
    fail(`${cmd} 执行失败`)
  }
}

console.log('== dsh-subagent-profile 发布脚本 ==')
if (dryRun) console.log('(dry-run 模式:只检查,不写文件、不提交、不打 tag、不发布)')

// ---------- 预检 ----------
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
const cur = pkg.version
const [maj, min, pat] = cur.split('.').map(Number)
const target = versionArg || `${maj}.${min}.${pat + 1}`
if (!/^\d+\.\d+\.\d+$/.test(target)) fail(`目标版本号格式不对:${target}`)

// 1. 版本是否已发布
let published = null
try {
  const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg.name)}`)
  if (res.ok) {
    const meta = await res.json()
    published = meta['dist-tags']?.latest || null
  }
} catch {
  /* registry 不可达则跳过此检查 */
}
if (published === target) fail(`版本 ${target} 已存在于 npm,不能重复发布`)

// 2. git 状态
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`当前分支是 ${branch},请在 main 上发布`)
const dirty = sh('git', ['status', '--porcelain'])
  .split('\n')
  .filter((l) => l && !l.startsWith('??'))
if (dirty.length) fail(`工作区有未提交的改动:\n${dirty.join('\n')}`)
sh('git', ['fetch', REMOTE])
const head = sh('git', ['rev-parse', 'HEAD'])
const remoteHead = sh('git', ['rev-parse', `${REMOTE}/main`])
if (head !== remoteHead) {
  fail(`本地 main(${head.slice(0, 7)}) 与 ${REMOTE}/main(${remoteHead.slice(0, 7)}) 不一致,请先推送或拉取`)
}

console.log(`\n当前版本 ${cur} -> 目标版本 ${target}${published ? `(npm latest 为 ${published})` : '(npm 上暂无此包)'}`)

// 3. 手动确认(非 TTY 环境自动跳过)
if (!dryRun && process.stdin.isTTY) {
  process.stdout.write('\n将提交、打 tag、推送并发布到 npm。按 Enter 继续,Ctrl+C 取消…')
  await new Promise((resolve) => process.stdin.once('data', resolve))
}

// ---------- 升版 ----------
if (!dryRun) {
  pkg.version = target
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`\npackage.json version -> ${target}`)
} else {
  console.log(`\n[dry-run] package.json version -> ${target}`)
}

// ---------- commit / tag / push ----------
step('git', ['add', 'package.json'])
step('git', ['commit', '-m', `chore: release v${target}`])
step('git', ['tag', '-a', `v${target}`, '-m', `v${target}`])
step('git', ['push', REMOTE, 'main'])
step('git', ['push', REMOTE, `v${target}`])

// ---------- npm 发布 ----------
console.log('\n$ pnpm publish --no-git-checks')
if (!dryRun) {
  try {
    execFileSync('pnpm', ['publish', '--no-git-checks'], { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
  } catch (e) {
    const msg = (e.stderr || '').toString()
    console.error(msg.trim())
    if (msg.includes('403') || msg.includes('Forbidden')) {
      console.error('\n发布被拒(403):需要 bypass-2FA 的 granular token。')
      console.error('解决:https://www.npmjs.com/settings/<你的用户名>/tokens 生成 Granular Access Token,')
      console.error('勾选 Bypass 2FA、选择包范围,把 token 写入 %LOCALAPPDATA%\\pnpm\\config\\auth.ini 后重试。')
    }
    fail('npm 发布失败')
  }
}

// ---------- 核验 ----------
try {
  const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg.name)}`)
  if (res.ok) {
    const meta = await res.json()
    console.log(`\n✅ 核验:npm latest = ${meta['dist-tags']?.latest}`)
  } else {
    console.log('\n(registry 核验失败,稍后手动确认)')
  }
} catch {
  console.log('\n(registry 核验失败,稍后手动确认)')
}

// ---------- Release Notes 草稿 ----------
const prevTag = trySh('git', ['describe', '--tags', '--abbrev=0', `v${target}^`])
console.log(`\n================ Release Notes 草稿(v${target}) ================`)
console.log(`# v${target}`)
console.log('')
console.log(`\`${pkg.name}\` ...(一句话简介:本次变更主题)`)
console.log('')
console.log('## 这个版本带来了什么')
console.log('')
console.log('- (把下面的提交整理成要点,或引用 PR 链接)')
console.log('')
if (prevTag) {
  const log = sh('git', ['log', `${prevTag}..HEAD`, '--oneline']) || '(无)'
  console.log(`自 ${prevTag} 以来的提交:`)
  console.log(log)
} else {
  console.log('(首个正式版本,无历史提交可列)')
}
console.log('')
console.log('安装与完整文档见 [README](README.md)。')
console.log('====================================================================')
console.log(`下一步:GitHub 网页 → Releases → Draft a new release → tag v${target} → 粘贴以上正文(删掉占位行)`)
console.log(`       或:gh release create v${target} --title "v${target}" --generate-notes`)
