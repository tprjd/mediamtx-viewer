import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// External systemd/filesystem boundary for adoption tests. Never writes host units.
export function hostJobFixture(directory, bin) {
  const root = join(directory, 'host-jobs')
  for (const program of ['install', 'mv']) {
    const real = execFileSync('which', [program], { encoding: 'utf8' }).trim()
    writeFileSync(join(bin, program), `#!/usr/bin/env node
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=${JSON.stringify(root)},prefixes=['/usr/local/libexec','/etc/systemd/system','/var/lib/mediamtx-deployment'];
const args=process.argv.slice(2).map(value=>prefixes.some(prefix=>value===prefix||value.startsWith(prefix+'/'))?root+value:value);
for(const value of args)if(value.startsWith(root+'/'))fs.mkdirSync(path.dirname(value),{recursive:true});
const result=spawnSync(${JSON.stringify(real)},args,{stdio:'inherit'});process.exit(result.status??1);
`, { mode: 0o700 })
  }
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\n[ "$1" != "-n" ] || shift\nexec "$@"\n', { mode: 0o700 })
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2),unit=args.at(-1),service=${JSON.stringify(join(root, 'etc/systemd/system/mediamtx-backup.service'))};
if(args[0]==='show' && args.includes('--property=DropInPaths'))process.exit(0);
if(args[0]==='show'){console.log(unit==='mediamtx-backup.service'?'loaded':'not-found');process.exit(unit==='mediamtx-backup.service'?0:1)}
if(args[0]==='cat'){console.log(fs.existsSync(service)?fs.readFileSync(service,'utf8'):'[Service]\\nExecStart=/old/checkout/backup');process.exit(0)}
if(args[0]==='daemon-reload')process.exit(0);process.exit(1);
`, { mode: 0o700 })
  return root
}
