/**
 * @description AuditReflectionBridge — Puente entre AuditReporter y ReflectionEngine.
 *
 * Permite conectar/desconectar el sistema de auditoría con el Reflection Engine
 * para auto-aprendizaje. Cuando está conectado, los hallazgos de auditoría se
 * reportan automáticamente al Reflection Engine, que detecta patrones y promueve
 * reglas de policy.
 *
 * @see AuditHook para la implementación concreta del reporte.
 */

import { ReflectionEngine } from '../../reflection/reflection-engine';
import { AuditHook } from '../../reflection/hooks/audit-hook';
import { GateRecord } from './types';

// ── AuditReflectionBridge ────────────────────────────────────────────────────

export class AuditReflectionBridge {
  private hook: AuditHook | null = null;

  /**
   * @description Conecta con el Reflection Engine.
   */
  connect(engine: ReflectionEngine): void {
    this.hook = new AuditHook(engine);
  }

  /**
   * @description Desconecta del Reflection Engine.
   */
  disconnect(): void {
    this.hook = null;
  }

  /**
   * @description Indica si está conectado.
   */
  get isConnected(): boolean {
    return this.hook !== null;
  }

  /**
   * @description Reporta los hallazgos de todos los gates al Reflection Engine.
   */
  async reportFindings(gates: GateRecord[]): Promise<void> {
    if (!this.hook) return;
    for (const gate of gates) {
      if (gate.hallazgos.length === 0) continue;
      await this.hook.reportFindings(gate.hallazgos, gate.gate, 'audit');
    }
  }
}
