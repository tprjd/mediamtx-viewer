"""Read-only VM measurements. Run from the deployed repository root."""
import json
import os
import subprocess
import time

compose = ['docker', 'compose', '--env-file', 'deploy/oracle/secrets/caddy.env', '-f', 'deploy/oracle/docker-compose.yml']

def run(args):
    return subprocess.check_output(args, text=True, timeout=20)

cpu = [int(value) for value in open('/proc/stat').readline().split()[1:9]]
memory = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in open('/proc/meminfo')}
ids = run(compose + ['ps', '-q', 'viewer', 'centrifugo']).split()
containers = []
for container in json.loads(run(['docker', 'inspect', *ids])):
    containers.append({
        'service': container['Config']['Labels']['com.docker.compose.service'],
        'imageId': container['Image'],
        'sourceFingerprint': container['Config']['Labels'].get('org.frankerzspam.source'),
        'image': container['Config']['Image'],
        'architecture': json.loads(run(['docker', 'image', 'inspect', container['Image']]))[0]['Architecture'],
        'health': container['State'].get('Health', {}).get('Status'),
        'running': container['State']['Running'],
        'restarts': container['RestartCount'],
    })
stats = [json.loads(line) for line in run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *ids]).splitlines()]
database = json.loads(run(compose + ['exec', '-T', 'viewer', 'node', '--input-type=module', '-e', """
import Database from 'better-sqlite3';
import {statSync, statfsSync} from 'node:fs';
const path = process.env.CHAT_DB_PATH;
const db = new Database(path, {readonly: true, fileMustExist: true, timeout: 1000});
const size = p => {try {return statSync(p).size} catch {return 0}};
const disk = statfsSync(path);
console.log(JSON.stringify({integrity: db.pragma('quick_check', {simple:true}),
  databaseBytes: size(path) + size(path+'-wal'), authBytes: size(process.env.AUTH_DB_PATH),
  freeBytes: disk.bavail * disk.bsize,
  outboxDepth: db.prepare('SELECT COUNT(*) AS n FROM chat_outbox').get().n,
  minimumFreeBytes: Number(process.env.CHAT_MINIMUM_FREE_BYTES || 10737418240),
  databaseLimitBytes: Number(process.env.CHAT_DATABASE_LIMIT_BYTES || 2147483648)}));
db.close();
"""]))
cpu_end = [int(value) for value in open('/proc/stat').readline().split()[1:9]]
cpu_total_delta = sum(cpu_end) - sum(cpu)
cpu_idle_delta = cpu_end[3] + cpu_end[4] - cpu[3] - cpu[4]
cpu_percent = 100 * (1 - cpu_idle_delta / cpu_total_delta) if cpu_total_delta else None
print(json.dumps({'cpuPercent': cpu_percent, 'at': time.time() * 1000, 'architecture': os.uname().machine,
    'cpuTotal': sum(cpu), 'cpuIdle': cpu[3] + cpu[4],
    'memoryAvailableBytes': memory['MemAvailable'], 'memoryTotalBytes': memory['MemTotal'],
    'load1': os.getloadavg()[0], 'containers': containers, 'stats': stats, 'database': database}))
