import { GenericContainer, Wait, StartedTestContainer } from 'testcontainers';
import Docker from 'dockerode';
import { getClient, resetClient } from '../src/docker/client';
import { containerCreate, containerExec, containerStop, containerRemove, containerLogs, containerInspect } from '../src/tools/container';
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
    .withName('docker-agent-test-dind')
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

async function pullAlpine(): Promise<void> {
  const docker = getClient();
  return new Promise((resolve, reject) => {
    docker.pull('alpine:latest', (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      if (!stream) return resolve();
      docker.modem.followProgress(stream, (pullErr: Error | null) => {
        if (pullErr) reject(pullErr);
        else resolve();
      });
    });
  });
}

describe('Docker Container Tools', () => {
  let containerId: string;

  beforeAll(async () => {
    await pullAlpine();
  }, 120000);

  test('container.create — creates and starts a container', async () => {
    const result = await containerCreate.execute({
      image: 'alpine:latest',
      name: 'docker-agent-test',
      cmd: ['sleep', '300'],
    }, mockCtx);

    const info = JSON.parse(result);
    expect(info.id).toBeDefined();
    expect(info.name).toBe('docker-agent-test');
    expect(info.status).toBe('running');
    containerId = info.id;
  }, 30000);

  test('container.inspect — returns container details', async () => {
    const result = await containerInspect.execute({ container: containerId }, mockCtx);
    const info = JSON.parse(result);
    expect(info.id).toBe(containerId);
    expect(info.state.running).toBe(true);
    expect(info.config.cmd).toEqual(['sleep', '300']);
  }, 15000);

  test('container.exec — runs a command and returns output', async () => {
    const result = await containerExec.execute({
      container: containerId,
      cmd: ['echo', 'hello-docker'],
    }, mockCtx);

    const execResult = JSON.parse(result);
    expect(execResult.exitCode).toBe(0);
    expect(execResult.stdout.trim()).toBe('hello-docker');
  }, 15000);

  test('container.logs — returns container logs', async () => {
    const logs = await containerLogs.execute({ container: containerId, tail: 10 }, mockCtx);
    expect(logs).toBeDefined();
  }, 15000);

  test('container.stop — stops a running container', async () => {
    const result = await containerStop.execute({ container: containerId, timeout: 5 }, mockCtx);
    const info = JSON.parse(result);
    expect(info.status).toBe('exited');
  }, 15000);

  test('container.remove — removes a stopped container', async () => {
    const result = await containerRemove.execute({ container: containerId, force: true }, mockCtx);
    const info = JSON.parse(result);
    expect(info.removed).toBe(containerId);

    await expect(
      containerInspect.execute({ container: containerId }, mockCtx),
    ).rejects.toThrow(/not found/i);
  }, 15000);
});
