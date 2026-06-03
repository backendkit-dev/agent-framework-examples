import {
  AgentEngine,
  AgentRegistry,
  ToolRegistry,
  ProviderRegistry,
  CallbackTransport,
} from '@bk/agent-core';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { loadConfig } from './config';

// Agents
import { INFRA_ORCHESTRATOR_PROFILE } from './agents/infra-orchestrator';
import { DOCKER_AGENT_PROFILE } from './agents/docker-agent';
import { COMPOSE_AGENT_PROFILE } from './agents/compose-agent';
import { SWARM_AGENT_PROFILE } from './agents/swarm-agent';
import { VOLUME_AGENT_PROFILE } from './agents/volume-agent';
import { CONTAINERD_AGENT_PROFILE } from './agents/containerd-agent';
import { K8S_AGENT_PROFILE } from './agents/k8s-agent';
import { SYSTEM_AGENT_PROFILE } from './agents/system-agent';
import { MONITOR_AGENT_PROFILE } from './agents/monitor-agent';
import { REGISTRY_AGENT_PROFILE } from './agents/registry-agent';

// Docker tools
import { containerCreate, containerExec, containerStop, containerRemove, containerLogs, containerInspect, containerList } from './tools/container';
import { systemInfo, systemPrune } from './tools/system';
import { imagePull, imageBuild, imageList, imageRemove, imageTag, imagePush } from './tools/image';
import { networkCreate, networkList, networkInspect, networkRemove, networkConnect } from './tools/network';

// Compose tools
import { composeTool } from './tools/compose-tool';

// Volume tools
import { volumeCreate, volumeList, volumeInspect, volumeRemove } from './tools/volume';

// Swarm tools
import {
  swarmServiceCreate, swarmServiceList, swarmServiceInspect, swarmServiceLogs,
  swarmServiceUpdate, swarmServiceRemove, swarmStackDeploy, swarmStackList,
  swarmStackRemove, swarmNodeList,
} from './tools/swarm';

// Containerd tools
import { containerdRun, containerdList, containerdStop, containerdRemove, containerdLogs, containerdPull } from './tools/containerd';

// K8s tools
import { k8sApply, k8sGet, k8sDescribe, k8sLogs, k8sExec, k8sDelete } from './tools/k8s';

// Monitor tools
import { containerStats, containerTop, containerHealth, eventsTail } from './tools/monitor';

// Registry tools
import { registryLogin, registryLogout, registrySearch, registryTags } from './tools/registry';

export function createInfraEngine(transport: CallbackTransport): AgentEngine {
  const config = loadConfig();

  const toolRegistry = new ToolRegistry();
  toolRegistry
    // Container
    .register(containerList).register(containerCreate).register(containerExec)
    .register(containerStop).register(containerRemove).register(containerLogs).register(containerInspect)
    // System
    .register(systemInfo).register(systemPrune)
    // Image
    .register(imagePull).register(imageBuild).register(imageList).register(imageRemove)
    .register(imageTag).register(imagePush)
    // Network
    .register(networkCreate).register(networkList).register(networkInspect)
    .register(networkRemove).register(networkConnect)
    // Compose (wrapped tools)
    .register(composeTool.up).register(composeTool.down).register(composeTool.build)
    .register(composeTool.ps).register(composeTool.logs)
    // Volume
    .register(volumeCreate).register(volumeList).register(volumeInspect).register(volumeRemove)
    // Swarm
    .register(swarmServiceCreate).register(swarmServiceList).register(swarmServiceInspect)
    .register(swarmServiceLogs).register(swarmServiceUpdate).register(swarmServiceRemove)
    .register(swarmStackDeploy).register(swarmStackList).register(swarmStackRemove)
    .register(swarmNodeList)
    // Containerd
    .register(containerdRun).register(containerdList).register(containerdStop)
    .register(containerdRemove).register(containerdLogs).register(containerdPull)
    // K8s
    .register(k8sApply).register(k8sGet).register(k8sDescribe)
    .register(k8sLogs).register(k8sExec).register(k8sDelete)
    // Monitor
    .register(containerStats).register(containerTop).register(containerHealth).register(eventsTail)
    // Registry
    .register(registryLogin).register(registryLogout).register(registrySearch).register(registryTags);

  const agentRegistry = new AgentRegistry();
  agentRegistry
    .register(INFRA_ORCHESTRATOR_PROFILE)
    .register(DOCKER_AGENT_PROFILE)
    .register(COMPOSE_AGENT_PROFILE)
    .register(SWARM_AGENT_PROFILE)
    .register(VOLUME_AGENT_PROFILE)
    .register(CONTAINERD_AGENT_PROFILE)
    .register(K8S_AGENT_PROFILE)
    .register(SYSTEM_AGENT_PROFILE)
    .register(MONITOR_AGENT_PROFILE)
    .register(REGISTRY_AGENT_PROFILE);

  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(
    config.llmProvider,
    new OpenAICompatibleProvider({
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      model: config.llmModel,
    }),
  );

  return new AgentEngine({
    model: {
      provider: config.llmProvider,
      id: config.llmModel,
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
    },
    agents: agentRegistry,
    tools: toolRegistry,
    providers: providerRegistry,
    defaultProvider: config.llmProvider,
    defaultAgentId: 'infra-orchestrator',
    transport,
    maxIterations: 50,
    iterationMode: 'auto',
  });
}
