import { runAll } from '../verify.mjs'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/chat-capacity/checks.mjs REPORT.json')
if (!await runAll(output)) process.exitCode = 1
