/**
 * @description Integración: verifica que el reward signal (QA score) actualiza
 * los pesos del router via EWMA y que GO/NO-GO van en la dirección correcta.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { RoutingWeightsStore } from '../../src/agent/routing/weights-store';

const ALPHA = 0.1;
const W_MIN = 0.1;
const W_MAX = 3.0;

function ewma(current: number, sample: number): number {
  return Math.min(W_MAX, Math.max(W_MIN, (1 - ALPHA) * current + ALPHA * sample));
}

describe('Reward Signal — EWMA routing weights', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reward-test-'));
    originalHome = process.env.HOME ?? process.env.USERPROFILE;
    // Redirigir HOME al tmpDir para que WeightsStore persista ahí
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GO review (score=1.0) incrementa el peso del agente', () => {
    const store = new RoutingWeightsStore();
    const initialWeight = store.get('qa-engineer'); // 1.0 default
    expect(initialWeight).toBe(1.0);

    store.recordSuccess('qa-engineer');
    const newWeight = store.get('qa-engineer');

    const expected = ewma(1.0, 1.0);
    expect(newWeight).toBeCloseTo(expected, 5);
    // Para score=1.0 y current=1.0 el EWMA sube (o se mantiene si ya está en 1.0)
    expect(newWeight).toBeGreaterThanOrEqual(initialWeight);
  });

  it('NO-GO review (score=0.0) decrementa el peso del agente', () => {
    const store = new RoutingWeightsStore();
    const initialWeight = store.get('backend-developer'); // 1.0 default

    store.recordFailure('backend-developer');
    const newWeight = store.get('backend-developer');

    const expected = ewma(1.0, 0.0);
    expect(newWeight).toBeCloseTo(expected, 5);
    expect(newWeight).toBeLessThan(initialWeight);
  });

  it('recordOutcome con score continuo aplica EWMA correctamente', () => {
    const store = new RoutingWeightsStore();
    const agent = 'test-agent';

    // Primer outcome: score 0.8 desde peso 1.0
    store.recordOutcome(agent, 0.8);
    const w1 = store.get(agent);
    expect(w1).toBeCloseTo(ewma(1.0, 0.8), 5);

    // Segundo outcome: score 0.5 desde w1
    store.recordOutcome(agent, 0.5);
    const w2 = store.get(agent);
    expect(w2).toBeCloseTo(ewma(w1, 0.5), 5);
  });

  it('pesos se persisten en disco y se recargan correctamente', () => {
    const store1 = new RoutingWeightsStore();
    store1.recordFailure('backend-developer');
    const saved = store1.get('backend-developer');

    // Nueva instancia debe cargar el mismo valor
    const store2 = new RoutingWeightsStore();
    store2.load();
    expect(store2.get('backend-developer')).toBeCloseTo(saved, 5);
  });

  it('pesos contextuales (domain:intent) se guardan separados del peso global', () => {
    const store = new RoutingWeightsStore();
    const agent = 'backend-developer';
    const ctx = { domain: 'testing', intent: 'implementation' };

    store.recordOutcome(agent, 0.5, ctx);

    // El peso global sigue siendo independiente
    const globalWeight = store.get(agent);
    const contextualWeight = store.get(agent, ctx);

    expect(globalWeight).toBeCloseTo(ewma(1.0, 0.5), 5);
    expect(contextualWeight).toBeCloseTo(ewma(1.0, 0.5), 5);

    // Después de otro outcome sin contexto, los dos divergen
    store.recordOutcome(agent, 0.9);
    expect(store.get(agent)).not.toBeCloseTo(store.get(agent, ctx), 3);
  });

  it('los pesos quedan acotados entre W_MIN y W_MAX', () => {
    const store = new RoutingWeightsStore();
    const agent = 'bounded-agent';

    // Muchos failures consecutivos
    for (let i = 0; i < 100; i++) store.recordFailure(agent);
    expect(store.get(agent)).toBeGreaterThanOrEqual(W_MIN);

    // Muchos successes consecutivos
    for (let i = 0; i < 100; i++) store.recordSuccess(agent);
    expect(store.get(agent)).toBeLessThanOrEqual(W_MAX);
  });
});
