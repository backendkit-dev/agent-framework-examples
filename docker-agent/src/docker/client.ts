import Docker from 'dockerode';
import { DockerConnectionError, DockerPermissionError } from '../errors';
import { loadConfig } from '../config';

let client: Docker | null = null;

export function getClient(): Docker {
  if (client) return client;

  const config = loadConfig();

  const opts: Docker.DockerOptions = { timeout: config.defaultTimeout };

  if (config.dockerHost) {
    opts.host = config.dockerHost;
  } else if (config.dockerSocketPath) {
    opts.socketPath = config.dockerSocketPath;
  } else if (config.platform === 'win32') {
    opts.socketPath = '//./pipe/docker_engine';
  } else {
    opts.socketPath = '/var/run/docker.sock';
  }

  try {
    client = new Docker(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('EACCES') || msg.includes('permission')) {
      throw new DockerPermissionError(msg);
    }
    throw new DockerConnectionError(msg);
  }

  return client;
}

export function resetClient(): void {
  client = null;
}
