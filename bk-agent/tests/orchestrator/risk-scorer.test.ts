/**
 * @description Tests para Risk Scorer — cálculo de riesgo técnico.
 */

import { calculateRisk, enrichTaskWithRisk } from '../../src/orchestrator/risk-scorer';
import { createTaskContext } from '../../src/types/task-context';
import { defaultOrchestratorConfig } from '../../src/orchestrator/types';

describe('RiskScorer', () => {
  describe('calculateRisk', () => {
    it('debe retornar low risk para tareas simples', () => {
      const result = calculateRisk('Agrega un comentario al README');

      expect(result.riskLevel).toBe('low');
      expect(result.totalScore).toBeLessThan(10);
    });

    it('debe detectar breaking_change por keywords', () => {
      const result = calculateRisk('Cambiar la API de usuarios es un breaking change');

      expect(result.riskFactors.breaking_change).toBe(true);
    });

    it('debe detectar security_sensitive por keywords', () => {
      const result = calculateRisk('Implementa autenticación con JWT y tokens');

      expect(result.riskFactors.security_sensitive).toBe(true);
    });

    it('debe detectar cross_service_impact por keywords', () => {
      const result = calculateRisk('Integra el microservicio de pagos con el de órdenes');

      expect(result.riskFactors.cross_service_impact).toBe(true);
    });

    it('debe detectar db_transactional por keywords', () => {
      const result = calculateRisk('Agrega una migración a la base de datos');

      expect(result.riskFactors.db_transactional).toBe(true);
    });

    it('debe detectar production_critical por keywords', () => {
      const result = calculateRisk('Hotfix crítico para producción');

      expect(result.riskFactors.production_critical).toBe(true);
    });

    it('debe calcular complexity según keywords', () => {
      const simple = calculateRisk('Tarea simple');
      const complex = calculateRisk('Implementación muy compleja y sofisticada');

      expect(simple.riskFactors.complexity).toBeLessThanOrEqual(complex.riskFactors.complexity);
    });

    it('debe retornar high o critical risk cuando múltiples factores se combinan', () => {
      const result = calculateRisk(
        'Breaking change crítico en producción que afecta autenticación JWT y base de datos'
      );

      expect(['high', 'critical']).toContain(result.riskLevel);
      expect(result.totalScore).toBeGreaterThanOrEqual(60);
    });

    it('debe retornar critical risk para cambios muy sensibles', () => {
      const result = calculateRisk(
        'Breaking change urgente en producción que modifica autenticación, base de datos y afecta múltiples microservicios'
      );

      expect(result.riskLevel).toBe('critical');
      expect(result.totalScore).toBeGreaterThanOrEqual(80);
    });

    it('debe incluir breakdown con factores y pesos', () => {
      const result = calculateRisk('Implementa autenticación JWT');

      expect(result.breakdown.length).toBeGreaterThan(0);
      const securityFactor = result.breakdown.find(b => b.factor === 'security_sensitive');
      expect(securityFactor).toBeDefined();
      expect(securityFactor!.weight).toBeGreaterThan(0);
    });

    it('debe usar configuración personalizada si se provee', () => {
      const config = defaultOrchestratorConfig();
      config.riskThresholds.high = 5;
      config.riskThresholds.critical = 200; // umbral muy alto para que no llegue a critical

      const result = calculateRisk('Breaking change en producción con autenticación', config);

      expect(result.riskLevel).toBe('high');
    });
  });

  describe('enrichTaskWithRisk', () => {
    it('debe enriquecer un TaskContext con riesgo calculado', () => {
      const task = createTaskContext('Breaking change en producción con autenticación');
      const enriched = enrichTaskWithRisk(task);

      expect(['high', 'critical']).toContain(enriched.riskLevel);
      expect(enriched.riskFactors.breaking_change).toBe(true);
      expect(enriched.riskFactors.production_critical).toBe(true);
      expect(enriched.riskFactors.security_sensitive).toBe(true);
    });

    it('debe marcar requiresArchitectureReview para high/critical', () => {
      const task = createTaskContext('Breaking change crítico en producción');
      const enriched = enrichTaskWithRisk(task);

      expect(['high', 'critical']).toContain(enriched.riskLevel);
      expect(enriched.requiresArchitectureReview).toBe(true);
    });

    it('debe marcar requiresSecurityReview si es security_sensitive', () => {
      const task = createTaskContext('Implementa autenticación JWT');
      const enriched = enrichTaskWithRisk(task);

      expect(enriched.riskFactors.security_sensitive).toBe(true);
      expect(enriched.requiresSecurityReview).toBe(true);
    });

    it('debe marcar requiresQaApproval para high/critical', () => {
      const task = createTaskContext('Breaking change crítico en producción');
      const enriched = enrichTaskWithRisk(task);

      expect(['high', 'critical']).toContain(enriched.riskLevel);
      expect(enriched.requiresQaApproval).toBe(true);
    });
  });
});
