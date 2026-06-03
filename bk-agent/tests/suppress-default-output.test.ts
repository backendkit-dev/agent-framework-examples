/**
 * @description Tests para la logica de suppressDefaultOutput en cli.ts
 *
 * Verifica que:
 * 1. Cuando el agente es qa-engineer (suppressDefaultOutput=true), la salida se suprime
 * 2. Cuando el agente es otro (backend-agent, suppressDefaultOutput=false/undefined),
 *    la salida se muestra normalmente
 * 3. Cuando currentAgentId es undefined, no hay crash ni comportamiento inesperado
 *
 * La logica bajo test replica el bloque en cli.ts:
 *   const currentAgent = allAgents.find(a => a.id === currentAgentId);
 *   if (currentAgent?.suppressDefaultOutput) return;
 */

import { AgentProfile } from '../src/agent/profiles';

// --- Funcion pura que replica la logica de onResponse en cli.ts ---

function shouldSuppressOutput(
  allAgents: AgentProfile[],
  currentAgentId: string | undefined
): boolean {
  const currentAgent = allAgents.find(a => a.id === currentAgentId);
  if (currentAgent?.suppressDefaultOutput) return true;
  return false;
}

// --- Tests ---

describe('suppressDefaultOutput logic (cli.ts onResponse)', () => {

  // Escenario 1: qa-engineer tiene suppressDefaultOutput=true
  describe('cuando el agente es qa-engineer', () => {
    it('suprime la salida (suppressDefaultOutput=true)', () => {
      const agents: AgentProfile[] = [
        {
          id: 'qa-engineer',
          name: 'QA Engineer',
          icon: 'flask',
          description: 'Testing, calidad, cobertura',
          systemPromptAddition: '',
          suppressDefaultOutput: true,
        },
        {
          id: 'backend-agent',
          name: 'Backend Developer',
          icon: 'monitor',
          description: 'APIs, business logic',
          systemPromptAddition: '',
        },
      ];

      const result = shouldSuppressOutput(agents, 'qa-engineer');
      expect(result).toBe(true);
    });
  });

  // Escenario 2: backend-agent no tiene suppressDefaultOutput
  describe('cuando el agente es backend-agent', () => {
    it('NO suprime la salida (suppressDefaultOutput es undefined)', () => {
      const agents: AgentProfile[] = [
        {
          id: 'qa-engineer',
          name: 'QA Engineer',
          icon: 'flask',
          description: 'Testing, calidad, cobertura',
          systemPromptAddition: '',
          suppressDefaultOutput: true,
        },
        {
          id: 'backend-agent',
          name: 'Backend Developer',
          icon: 'monitor',
          description: 'APIs, business logic',
          systemPromptAddition: '',
        },
      ];

      const result = shouldSuppressOutput(agents, 'backend-agent');
      expect(result).toBe(false);
    });

    it('NO suprime la salida cuando suppressDefaultOutput es false explicito', () => {
      const agents: AgentProfile[] = [
        {
          id: 'backend-agent',
          name: 'Backend Developer',
          icon: 'monitor',
          description: 'APIs, business logic',
          systemPromptAddition: '',
          suppressDefaultOutput: false,
        },
      ];

      const result = shouldSuppressOutput(agents, 'backend-agent');
      expect(result).toBe(false);
    });
  });

  // Escenario 3: currentAgentId es undefined
  describe('cuando currentAgentId es undefined', () => {
    it('no hace crash y no suprime la salida', () => {
      const agents: AgentProfile[] = [
        {
          id: 'qa-engineer',
          name: 'QA Engineer',
          icon: 'flask',
          description: 'Testing, calidad, cobertura',
          systemPromptAddition: '',
          suppressDefaultOutput: true,
        },
      ];

      // Debe ejecutarse sin lanzar excepcion
      expect(() => {
        const result = shouldSuppressOutput(agents, undefined);
        expect(result).toBe(false);
      }).not.toThrow();
    });

    it('no suprime la salida cuando el array de agentes esta vacio', () => {
      const agents: AgentProfile[] = [];

      expect(() => {
        const result = shouldSuppressOutput(agents, undefined);
        expect(result).toBe(false);
      }).not.toThrow();
    });
  });

  // Escenario adicional: agente no encontrado en la lista
  describe('cuando currentAgentId no existe en allAgents', () => {
    it('no suprime la salida (find devuelve undefined)', () => {
      const agents: AgentProfile[] = [
        {
          id: 'qa-engineer',
          name: 'QA Engineer',
          icon: 'flask',
          description: 'Testing, calidad, cobertura',
          systemPromptAddition: '',
          suppressDefaultOutput: true,
        },
      ];

      const result = shouldSuppressOutput(agents, 'non-existent-agent');
      expect(result).toBe(false);
    });
  });

  // Verificacion contra los built-in profiles reales
  describe('con los built-in profiles reales', () => {
    it('qa-engineer tiene suppressDefaultOutput=true', () => {
      const { BUILTIN_PROFILES } = require('../src/agent/profiles');
      const qaProfile = BUILTIN_PROFILES.find((p: AgentProfile) => p.id === 'qa-engineer');
      expect(qaProfile?.suppressDefaultOutput).toBe(true);
    });

    it('ningun otro built-in tiene suppressDefaultOutput=true', () => {
      const { BUILTIN_PROFILES } = require('../src/agent/profiles');
      const othersWithFlag = BUILTIN_PROFILES.filter(
        (p: AgentProfile) => p.id !== 'qa-engineer' && p.suppressDefaultOutput === true
      );
      expect(othersWithFlag).toHaveLength(0);
    });
  });
});
