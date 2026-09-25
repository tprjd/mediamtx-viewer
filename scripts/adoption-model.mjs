import { basename } from 'node:path'
import { runtimeIdentity } from './deployment-state.mjs'

export const adoptionServices = ['viewer', 'caddy', 'centrifugo', 'mediamtx', 'mediamtx-health', 'thumbnailer', 'discord-notifier']
export function adoptionModel(containers, { project, destination }) {
  const model = { name: project, services: {}, volumes: {}, networks: {} }, copies = [], runtime = {}
  if (containers.length !== adoptionServices.length) throw new Error('Adoption service set differs')
  for (const container of containers) {
    const name = container.Config.Labels?.['com.docker.compose.service'], config = container.Config, host = container.HostConfig
    if (!adoptionServices.includes(name) || model.services[name] || config.Labels['com.docker.compose.project'] !== project) throw new Error('Adoption service ownership differs')
    if (host.Privileged || host.AutoRemove || host.PublishAllPorts || host.PidMode || host.IpcMode !== 'private' || host.UsernsMode || host.UTSMode || host.Runtime && host.Runtime !== 'runc' ||
        host.Devices?.length || host.DeviceRequests?.length || host.VolumesFrom?.length || Object.keys(host.Tmpfs ?? {}).length || host.Links?.length || host.SecurityOpt?.length || host.Init || host.GroupAdd?.length || host.ShmSize !== 67108864 || config.Tty || config.OpenStdin || config.StdinOnce || config.AttachStdin || host.ContainerIDFile || Object.keys(host.StorageOpt ?? {}).length || host.CgroupParent || host.CgroupnsMode && host.CgroupnsMode !== 'private' || host.CpuRealtimePeriod || host.CpuRealtimeRuntime || host.BlkioWeight || host.BlkioWeightDevice?.length || host.BlkioDeviceReadBps?.length || host.BlkioDeviceWriteBps?.length || host.BlkioDeviceReadIOps?.length || host.BlkioDeviceWriteIOps?.length ||
        [host.Memory, host.MemorySwap, host.MemoryReservation, host.NanoCpus, host.CpuQuota, host.CpuPeriod, host.CpuShares, host.PidsLimit, host.OomScoreAdj].some(value => value && value !== -1) || host.CpusetCpus || host.CpusetMems || host.OomKillDisable ||
        !Object.keys(container.NetworkSettings.Networks).length || ['host', 'none', 'bridge'].includes(host.NetworkMode) || host.NetworkMode.startsWith('container:')) throw new Error('Adoption runtime settings are unsupported; repair configuration first')
    if (config.Hostname !== container.Id.slice(0, 12)) throw new Error('Adoption custom hostname is unsupported')
    const environment = {}
    for (const item of config.Env ?? []) {
      const at = item.indexOf('='); if (at < 1 || Object.hasOwn(environment, item.slice(0, at))) throw new Error('Adoption environment is inconsistent')
      environment[item.slice(0, at)] = item.slice(at + 1)
    }
    const value = { image: container.Image, entrypoint: config.Entrypoint ?? undefined, command: config.Cmd ?? undefined, environment,
      user: config.User || undefined, working_dir: config.WorkingDir || undefined, restart: 'no', volumes: [], networks: {},
      labels: Object.fromEntries(Object.entries(config.Labels ?? {}).filter(([key]) => !key.startsWith('com.docker.compose.'))),
      logging: { driver: host.LogConfig.Type, options: host.LogConfig.Config }, read_only: host.ReadonlyRootfs }
    if (config.StopSignal) value.stop_signal = config.StopSignal
    if (config.StopTimeout !== undefined) value.stop_grace_period = `${config.StopTimeout}s`
    if (config.Domainname) value.domainname = config.Domainname
    for (const [field, property] of [['CapAdd', 'cap_add'], ['CapDrop', 'cap_drop'], ['Dns', 'dns'], ['DnsSearch', 'dns_search'], ['DnsOptions', 'dns_opt'], ['ExtraHosts', 'extra_hosts']]) if (host[field]?.length) value[property] = host[field]
    if (Object.keys(host.Sysctls ?? {}).length) value.sysctls = host.Sysctls
    if (host.Ulimits?.length) value.ulimits = Object.fromEntries(host.Ulimits.map(limit => [limit.Name, { soft: limit.Soft, hard: limit.Hard }]))
    if (config.Healthcheck) {
      value.healthcheck = { test: config.Healthcheck.Test }
      for (const [field, property] of [['Interval', 'interval'], ['Timeout', 'timeout'], ['StartPeriod', 'start_period'], ['StartInterval', 'start_interval']]) if (config.Healthcheck[field]) value.healthcheck[property] = `${config.Healthcheck[field]}ns`
      if (config.Healthcheck.Retries) value.healthcheck.retries = config.Healthcheck.Retries
    }
    value.ports = Object.entries(host.PortBindings ?? {}).flatMap(([port, bindings]) => (bindings ?? []).map(binding => {
      if (!binding.HostPort || binding.HostPort === '0') throw new Error('Adoption requires fixed published ports')
      const [target, protocol] = port.split('/')
      return { target: Number(target), published: binding.HostPort, host_ip: binding.HostIp || undefined, protocol }
    }))
    if (!value.ports.length) delete value.ports
    for (const [network, connection] of Object.entries(container.NetworkSettings.Networks)) {
      if (connection.IPAMConfig && Object.values(connection.IPAMConfig).some(Boolean)) throw new Error('Adoption static network addresses are unsupported')
      model.networks[network] = { name: network, external: true }
      value.networks[network] = { aliases: (connection.Aliases ?? []).filter(alias => alias !== container.Id.slice(0, 12) && alias !== container.Name.slice(1)) }
    }
    for (const mount of container.Mounts) {
      if (mount.Type === 'volume' && mount.Name) {
        model.volumes[mount.Name] = { name: mount.Name, external: true }
        value.volumes.push({ type: 'volume', source: mount.Name, target: mount.Destination, read_only: !mount.RW })
      } else if (mount.Type === 'bind' && !mount.RW && mount.Propagation === 'rprivate') {
        const folder = `mounts/${name}-${value.volumes.length}`
        copies.push({ container: container.Id, path: mount.Destination, folder })
        value.volumes.push({ type: 'bind', source: `${destination}/${folder}/${basename(mount.Destination)}`, target: mount.Destination, read_only: true })
      } else throw new Error('Adoption mount is unsupported; preserve its data and repair configuration first')
    }
    model.services[name] = value
    runtime[name] = runtimeIdentity(container)
  }
  model.services.viewer.entrypoint = ['node']
  model.services.viewer.command = ['server.js']
  const chat = model.services.viewer.environment.CHAT_ENABLED
  if (!['true', 'false'].includes(chat)) throw new Error('Adoption Chat state is unknown')
  return { model, runtime, copies, chatEnabled: chat === 'true' }
}

// Only these intentional changes distinguish the adopted recovery runtime.
export function adoptedRecoveryRuntime(record) {
  if (!record.adoption?.legacyRuntime) return record.runtime
  const runtime = structuredClone(record.runtime)
  for (const [name, value] of Object.entries(runtime)) {
    value.config.Image = value.image
    value.host.RestartPolicy = { Name: 'no', MaximumRetryCount: 0 }
    if (name === 'viewer') { value.config.Entrypoint = ['node']; value.config.Cmd = ['server.js'] }
    for (const mount of value.mounts.filter(mount => mount.Type === 'bind')) {
      const destination = record.model.services[name].volumes.find(item => item.type === 'bind' && item.target === mount.Destination)?.source
      if (!destination) throw new Error('Adopted mount identity is missing')
      value.host.Binds = value.host.Binds?.map(bind => bind.startsWith(`${mount.Source}:`) ? destination + bind.slice(mount.Source.length) : bind)
      for (const item of value.host.Mounts ?? []) if (item.Type === 'bind' && item.Target === mount.Destination) item.Source = destination
      mount.Source = destination
    }
  }
  return runtime
}
