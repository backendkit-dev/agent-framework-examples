import { defineTool, z } from './define-tool';
import { getClient } from '../docker/client';

export const networkCreate = defineTool({
  name: 'network_create',
  description: 'Create a Docker network',
  input: z.object({
    name: z.string().describe('Network name'),
    driver: z.enum(['bridge', 'host', 'overlay', 'macvlan', 'none']).optional().default('bridge'),
    subnet: z.string().optional().describe('Subnet in CIDR format (e.g. 172.20.0.0/16)'),
    gateway: z.string().optional().describe('Gateway IP'),
    internal: z.boolean().optional().describe('Restrict external access'),
    attachable: z.boolean().optional().describe('Allow manual container attachment (overlay)'),
    labels: z.record(z.string()).optional(),
  }),
  async execute({ name, driver, subnet, gateway, internal, attachable, labels }) {
    const docker = getClient();
    const opts: Record<string, unknown> = { Name: name, Driver: driver ?? 'bridge' };
    if (internal) opts.Internal = true;
    if (attachable) opts.Attachable = true;
    if (labels) opts.Labels = labels;
    if (subnet || gateway) {
      opts.IPAM = {
        Config: [{ Subnet: subnet, Gateway: gateway }].filter(c => c.Subnet || c.Gateway),
      };
    }
    const net = await docker.createNetwork(opts as unknown as Parameters<typeof docker.createNetwork>[0]);
    const info = await net.inspect();
    return JSON.stringify({ id: info.Id.slice(0, 12), name: info.Name, driver: info.Driver, scope: info.Scope });
  },
});

export const networkList = defineTool({
  name: 'network_list',
  description: 'List Docker networks',
  input: z.object({
    filter: z.string().optional().describe('Filter by name'),
  }),
  async execute({ filter }) {
    const docker = getClient();
    const networks = await docker.listNetworks();
    const filtered = filter ? networks.filter(n => n.Name.includes(filter)) : networks;
    if (filtered.length === 0) return 'No networks found';
    return filtered.map(n =>
      `${n.Name.padEnd(25)} ${n.Driver.padEnd(10)} ${n.Scope.padEnd(8)} ${n.Id.slice(0, 12)}`
    ).join('\n');
  },
});

export const networkInspect = defineTool({
  name: 'network_inspect',
  description: 'Inspect a Docker network',
  input: z.object({
    network: z.string().describe('Network name or ID'),
  }),
  async execute({ network }) {
    const docker = getClient();
    const net = docker.getNetwork(network);
    const info = await net.inspect();
    return JSON.stringify({
      id: info.Id.slice(0, 12),
      name: info.Name,
      driver: info.Driver,
      scope: info.Scope,
      ipam: info.IPAM,
      containers: Object.keys(info.Containers ?? {}).length,
      labels: info.Labels,
    }, null, 2);
  },
});

export const networkRemove = defineTool({
  name: 'network_remove',
  description: 'Remove a Docker network',
  input: z.object({
    network: z.string().describe('Network name or ID'),
  }),
  async execute({ network }) {
    const docker = getClient();
    const net = docker.getNetwork(network);
    await net.remove();
    return `Removed network: ${network}`;
  },
});

export const networkConnect = defineTool({
  name: 'network_connect',
  description: 'Connect a container to a network',
  input: z.object({
    network: z.string().describe('Network name or ID'),
    container: z.string().describe('Container name or ID'),
    alias: z.string().optional().describe('Network alias for the container'),
  }),
  async execute({ network, container, alias }) {
    const docker = getClient();
    const net = docker.getNetwork(network);
    const opts: Record<string, unknown> = { Container: container };
    if (alias) opts.EndpointConfig = { Aliases: [alias] };
    await net.connect(opts as Parameters<typeof net.connect>[0]);
    return `Connected container "${container}" to network "${network}"`;
  },
});

