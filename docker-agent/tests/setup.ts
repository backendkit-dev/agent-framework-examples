import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

let container: StartedTestContainer | undefined;

export async function startDockerMock(): Promise<StartedTestContainer> {
  container = await new GenericContainer('docker:dind')
    .withName('docker-agent-test-dind')
    .withPrivileged()
    .withExposedPorts(2375)
    .withWaitStrategy(Wait.forLogMessage('Docker daemon'))
    .start();
  return container;
}

export async function stopDockerMock(): Promise<void> {
  if (container) {
    await container.stop();
    container = undefined;
  }
}

export function getDockerHost(container: StartedTestContainer): string {
  return `tcp://localhost:${container.getMappedPort(2375)}`;
}

afterAll(async () => {
  await stopDockerMock();
});
