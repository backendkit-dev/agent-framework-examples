import { GenericContainer, Wait, StartedTestContainer } from 'testcontainers';
import { getClient, resetClient } from '../src/docker/client';
import { systemInfo, systemPrune } from '../src/tools/system';
import type { ExecutionContext } from '@bk/agent-core';

let dind: StartedTestContainer;
let dockerHost: string;

const mockCtx: ExecutionContext = {
  agentId: 'docker-agent',
  sessionId: 'test-session',
  memory: { get: () => undefined, set: () => {}, getAll: () => ({}) },
  askAgent: async () => '',
};

beforeAll(async () => {
  dind = await new GenericContainer('docker:dind')
    .withName('docker-agent-system-test-dind')
    .withPrivileged()
    .withExposedPorts(2375)
    .withWaitStrategy(Wait.forLogMessage('Docker daemon'))
    .start();

  dockerHost = `tcp://localhost:${dind.getMappedPort(2375)}`;
  process.env.DOCKER_HOST = dockerHost;
  process.env.DOCKER_SOCKET_PATH = '';
  resetClient();
}, 120000);

afterAll(async () => {
  await dind.stop();
  delete process.env.DOCKER_HOST;
  resetClient();
}, 30000);

beforeEach(() => {
  resetClient();
});

describe('Docker System Tools', () => {
  test('system.info — returns daemon information', async () => {
    const result = await systemInfo.execute({}, mockCtx);
    const info = JSON.parse(result);

    expect(info).toHaveProperty('id');
    expect(info).toHaveProperty('serverVersion');
    expect(info).toHaveProperty('operatingSystem');
    expect(info).toHaveProperty('architecture');
    expect(info).toHaveProperty('cpus');
    expect(info).toHaveProperty('memory');
    expect(info).toHaveProperty('containers');
    expect(info).toHaveProperty('running');
    expect(info).toHaveProperty('images');
    expect(info).toHaveProperty('storageDriver');
    expect(info).toHaveProperty('dockerRootDir');

    expect(typeof info.serverVersion).toBe('string');
    expect(info.serverVersion.length).toBeGreaterThan(0);
    expect(typeof info.cpus).toBe('number');
    expect(info.cpus).toBeGreaterThan(0);
    expect(typeof info.memory).toBe('number');
    expect(info.memory).toBeGreaterThan(0);
  }, 15000);

  test('system.prune — executes prune without errors', async () => {
    const result = await systemPrune.execute({ all: false, volumes: false }, mockCtx);

    expect(typeof result).toBe('string');
    expect(result).toContain('Total reclaimed space');
  }, 30000);

  test('system.prune — accepts all and volumes flags', async () => {
    const result = await systemPrune.execute({ all: true, volumes: true }, mockCtx);

    expect(typeof result).toBe('string');
    expect(result).toContain('Total reclaimed space');
  }, 30000);
});
