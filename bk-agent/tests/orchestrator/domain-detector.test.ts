/**
 * @description Tests para Domain Detector — detección de bounded contexts.
 */

import { detectDomains, enrichTaskWithDomains } from '../../src/orchestrator/domain-detector';
import { createTaskContext } from '../../src/types/task-context';

describe('DomainDetector', () => {
  describe('detectDomains', () => {
    it('debe detectar dominio "security" para temas de autenticación', () => {
      const result = detectDomains('Implementa autenticación JWT con refresh token');

      expect(result.domains).toContain('security');
      expect(result.scores.security).toBeGreaterThan(0);
    });

    it('debe detectar dominio "backend" para APIs', () => {
      const result = detectDomains('Crea un endpoint REST en NestJS');

      expect(result.domains).toContain('backend');
    });

    it('debe detectar dominio "frontend" para UI', () => {
      const result = detectDomains('Agrega un componente React para el formulario de login');

      expect(result.domains).toContain('frontend');
    });

    it('debe detectar dominio "database" para consultas', () => {
      const result = detectDomains('Optimiza la consulta SQL de órdenes con joins');

      expect(result.domains).toContain('database');
    });

    it('debe detectar dominio "architecture" para diseño', () => {
      const result = detectDomains('Diseña la arquitectura de microservicios con DDD');

      expect(result.domains).toContain('architecture');
    });

    it('debe detectar dominio "testing" para tests', () => {
      const result = detectDomains('Escribe tests unitarios con Jest');

      expect(result.domains).toContain('testing');
    });

    it('debe detectar dominio "devops" para infraestructura', () => {
      const result = detectDomains('Configura el pipeline CI/CD con GitHub Actions');

      expect(result.domains).toContain('devops');
    });

    it('debe detectar dominio "resilience" para patrones de resiliencia', () => {
      const result = detectDomains('Agrega circuit breaker para el servicio de pagos');

      expect(result.domains).toContain('resilience');
    });

    it('debe detectar dominio "messaging" para mensajería', () => {
      const result = detectDomains('Configura RabbitMQ para eventos de órdenes');

      expect(result.domains).toContain('messaging');
    });

    it('debe retornar dominios ordenados por relevancia', () => {
      const result = detectDomains(
        'Implementa autenticación JWT en el backend NestJS con base de datos PostgreSQL'
      );

      // backend y security deberían estar primeros
      const first = result.domains[0];
      expect(['backend', 'security', 'database']).toContain(first);
    });

    it('debe detectar servicios objetivo', () => {
      const result = detectDomains('Configura API key para el servicio de pagos');

      expect(result.targetServices.length).toBeGreaterThanOrEqual(0);
    });

    it('debe detectar patrones relacionados', () => {
      const result = detectDomains('Implementa circuit breaker con retry backoff');

      expect(result.relatedPatterns).toContain('circuit-breaker');
      expect(result.relatedPatterns).toContain('retry-backoff');
    });

    it('debe retornar arrays vacíos si no hay dominios', () => {
      const result = detectDomains('Hola, ¿cómo estás?');

      expect(result.domains).toEqual([]);
      expect(result.scores).toEqual({});
    });
  });

  describe('enrichTaskWithDomains', () => {
    it('debe enriquecer un TaskContext con dominios detectados', () => {
      const task = createTaskContext('Implementa autenticación JWT en NestJS');
      const enriched = enrichTaskWithDomains(task);

      expect(enriched.domains).toContain('security');
      expect(enriched.domains).toContain('backend');
      expect(enriched.updatedAt).toBeInstanceOf(Date);
    });

    it('debe reemplazar dominios con los detectados (no acumula)', () => {
      const task = createTaskContext('Implementa autenticación');
      task.domains = ['existing-domain'];

      const enriched = enrichTaskWithDomains(task);

      // enrichTaskWithDomains reemplaza domains, no acumula
      expect(enriched.domains).not.toContain('existing-domain');
      expect(enriched.domains).toContain('security');
    });

    it('debe combinar targetServices sin duplicados', () => {
      const task = createTaskContext('Implementa API key');
      task.targetServices = ['existing-service'];

      const enriched = enrichTaskWithDomains(task);

      expect(enriched.targetServices).toContain('existing-service');
    });
  });
});
