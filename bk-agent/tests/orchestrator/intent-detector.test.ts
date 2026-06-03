/**
 * @description Tests para Intent Detector — clasificación de acciones.
 */

import { detectIntent, enrichTaskWithIntent } from '../../src/orchestrator/intent-detector';
import { createTaskContext } from '../../src/types/task-context';

describe('IntentDetector', () => {
  describe('detectIntent', () => {
    it('debe detectar "implementation" para solicitudes de código', async () => {
      const result = await detectIntent('Implementa un endpoint REST para crear usuarios');

      expect(result.actionType).toBe('implementation');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.method).toBe('keyword');
    });

    it('debe detectar "design" para solicitudes de arquitectura', async () => {
      const result = await detectIntent('Diseña la arquitectura para el módulo de pagos');

      expect(result.actionType).toBe('design');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('debe detectar "bugfix" para reportes de error', async () => {
      const result = await detectIntent('Corrige el bug en el login que lanza null pointer');

      expect(result.actionType).toBe('bugfix');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('debe detectar "security_audit" para solicitudes de seguridad', async () => {
      const result = await detectIntent('Audita la seguridad del módulo de autenticación JWT');

      expect(result.actionType).toBe('security_audit');
    });

    it('debe detectar "test" para solicitudes de testing', async () => {
      const result = await detectIntent('Escribe tests unitarios para el servicio de órdenes');

      expect(result.actionType).toBe('test');
    });

    it('debe detectar "refactor" para solicitudes de mejora', async () => {
      const result = await detectIntent('Refactoriza el controlador de usuarios para separar responsabilidades');

      expect(result.actionType).toBe('refactor');
    });

    it('debe detectar "documentation" para solicitudes de documentación', async () => {
      const result = await detectIntent('Documenta la API REST con OpenAPI');

      expect(result.actionType).toBe('documentation');
    });

    it('debe detectar "research" para solicitudes de investigación', async () => {
      const result = await detectIntent('Investiga qué es event sourcing y cómo funciona');

      expect(result.actionType).toBe('research');
    });

    it('debe detectar "optimize" para solicitudes de rendimiento', async () => {
      const result = await detectIntent('Optimiza la consulta lenta de órdenes');

      expect(result.actionType).toBe('optimize');
    });

    it('debe detectar "deploy" para solicitudes de despliegue', async () => {
      const result = await detectIntent('Despliega el microservicio en Kubernetes');

      expect(result.actionType).toBe('deploy');
    });

    it('debe retornar "implementation" como fallback para input sin señales claras', async () => {
      const result = await detectIntent('Hola, ¿cómo estás?');

      expect(result.actionType).toBe('implementation');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('debe retornar scores para todas las acciones', async () => {
      const result = await detectIntent('Implementa un endpoint');

      const actions = Object.keys(result.scores);
      expect(actions).toContain('implementation');
      expect(actions).toContain('design');
      expect(actions).toContain('bugfix');
      expect(actions).toContain('unknown');
    });

    it('debe priorizar la acción con mayor score', async () => {
      const result = await detectIntent(
        'Implementa un endpoint REST para crear usuarios'
      );

      // implementation tiene más peso que otras acciones
      expect(result.actionType).toBe('implementation');
    });
  });

  describe('enrichTaskWithIntent', () => {
    it('debe enriquecer un TaskContext con el actionType detectado', async () => {
      const task = createTaskContext('Implementa un módulo de pagos');
      const enriched = await enrichTaskWithIntent(task);

      expect(enriched.actionType).toBe('implementation');
      expect(enriched.status).toBe('classified');
      expect(enriched.updatedAt).toBeInstanceOf(Date);
    });

    it('debe asignar "implementation" como fallback si no se detecta acción', async () => {
      const task = createTaskContext('Hola mundo');
      const enriched = await enrichTaskWithIntent(task);

      expect(enriched.actionType).toBe('implementation');
      expect(enriched.status).toBe('classified');
    });
  });
});
