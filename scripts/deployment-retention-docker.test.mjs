// @vitest-environment node
// Long command-level checks. Run explicitly when Docker verification is requested.
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { docker, inspect, stagingFixture } from './fixtures/staging-setup.mjs'

it('retains two accepted releases and two encrypted sets on both machines after repeated deployments', async () => {
  await stagingFixture(async ({ command, project, directory }) => {
    const sources = []
    let firstBackup
    for (let n = 0; n < 3; n++) {
      const hook = join(directory, 'disconnect-cleanup.mjs')
      if (n === 2) writeFileSync(hook, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const remove=fs.rmSync; fs.rmSync=(path,...args)=>{if(path===${JSON.stringify(dirname(firstBackup))})process.kill(process.pid,'SIGKILL');return remove(path,...args)}; syncBuiltinESMExports();`)
      let result = await command('managed', n === 2 ? { NODE_OPTIONS: `--import=${hook}` } : {})
      if (n === 2) {
        expect(result.status).not.toBe(0)
        expect(existsSync(firstBackup)).toBe(true)
        const status = JSON.parse((await command('status')).stdout)
        expect(status.owner).toBe('abandoned')
        result = await command('recover', {}, ['--release', 'candidate', '--restore', 'none'])
      }
      expect(result.status, result.stderr + result.diagnostic).toBe(0)
      const state = JSON.parse(result.stdout)
      firstBackup ??= state.backup.workstationManifest
      sources.push(state.candidateRelease.source)
      expect(state.retention.status, JSON.stringify(state.retention)).toBe('complete')
      expect(state.retention.host.releases).toHaveLength(2)
      expect(state.retention.host.backups.kept).toHaveLength(Math.min(2, n + 1))
      expect(state.retention.workstation.kept).toHaveLength(Math.min(2, n + 1))
    }
    expect(existsSync(firstBackup)).toBe(false)
    const viewer = inspect(`${project}-viewer-1`)
    const root = `${project}-deployment-staging`
    const inventory = JSON.parse(docker('run', '--rm', '--user', '0', '-v', `${root}:/stage:ro`, '--entrypoint', 'node', viewer.Image,
      '-e', 'const f=require("fs"); const h=JSON.parse(f.readFileSync("/stage/retention.json")); console.log(JSON.stringify({sources:h.releases.map(r=>r.source),ids:h.releases.map(r=>r.runtime.viewer.image),gone:!f.existsSync(process.argv[1])}))', sources[0]))
    expect(inventory.sources).toEqual(sources.slice(1).reverse())
    expect(inventory.gone).toBe(true)
    expect(inventory.ids).toEqual([viewer.Image, viewer.Image])
    const cleanup = await command('cleanup')
    expect(cleanup.status, cleanup.stderr).toBe(0)
    expect(JSON.parse(cleanup.stdout).retention.registry.cleanup).toBe('disabled')
  }, { managed: true })
}, 600000)

it('does not rotate successful history after a failed activation or accept cleanup during unresolved recovery', async () => {
  await stagingFixture(async ({ command, fault, project }) => {
    const success = await command('managed')
    expect(success.status, success.stderr).toBe(0)
    const accepted = JSON.parse(success.stdout)
    const retained = accepted.retention.host.releases
    const observe = () => JSON.parse(docker('run', '--rm', '--user', '0', '-v', `${project}-deployment-staging:/stage:ro`, '--volumes-from', `${project}-viewer-1:ro`, '--entrypoint', 'node', inspect(`${project}-viewer-1`).Image, '-e',
      'const f=require("fs");const h=JSON.parse(f.readFileSync("/stage/retention.json"));console.log(JSON.stringify({sources:h.releases.map(r=>r.source),trees:h.releases.map(r=>f.existsSync(r.source)),backup:["manifest.json","auth.sqlite.enc","chat.sqlite.enc"].every(name=>f.existsSync(require("path").join(require("path").dirname(process.argv[1]),name))),images:h.releases.flatMap(r=>Object.values(r.runtime).map(s=>s.image))}))', accepted.backup.hostManifest))
    fault('activation-failure')
    const failed = await command('managed')
    expect(failed.status).not.toBe(0)
    expect(JSON.parse(failed.stderr).result, failed.stderr + failed.diagnostic).toBe('failed-rolled-back')
    fault('')
    const cleanup = await command('cleanup')
    expect(cleanup.status).not.toBe(0)
    fault('interrupt-auth')
    expect((await command('managed')).status).not.toBe(0)
    expect((await command('cleanup')).status).not.toBe(0)
    const actual = observe()
    expect(actual.sources).toEqual(retained)
    expect(actual.trees).toEqual([true, true])
    expect(actual.backup).toBe(true)
    for (const name of ['manifest.json', 'auth.sqlite.enc', 'chat.sqlite.enc']) expect(existsSync(join(dirname(accepted.backup.workstationManifest), name))).toBe(true)
    for (const image of new Set(actual.images)) expect(JSON.parse(docker('image', 'inspect', image))[0].Id).toBe(image)
  }, { managed: true, migrations: { 'migrations/900_once.sql': 'CREATE TABLE once_migration (id INTEGER PRIMARY KEY);' } })
}, 600000)
