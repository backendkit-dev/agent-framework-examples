/**
 * @description Domain Detector — Detecta los bounded contexts/dominios
 * a partir del input del usuario.
 * 
 * Usa keywords + bigramas para identificar dominios técnicos.
 * Soporta detección de servicios objetivo y patrones relacionados.
 * 
 * @see capability-matrix.yaml en ~/.deepseek-code/ para la lista completa
 * de dominios por agente.
 */

import { TaskContext } from '../types/task-context';

// ── Keywords por dominio ─────────────────────────────────────────────────────

interface DomainKeyword {
  words: string[];
  /** Servicio objetivo asociado (opcional) */
  service?: string;
  /** Patrón relacionado del vault (opcional) */
  pattern?: string;
}

/**
 * Mapa de dominios con sus keywords.
 * Este mapa base se puede extender desde ~/.deepseek-code/capability-matrix.yaml
 */
const DOMAIN_KEYWORDS: Record<string, DomainKeyword[]> = {
  security: [
    { words: ['jwt', 'token', 'autenticación', 'autenticacion', 'auth'], pattern: 'jwt-auth' },
    { words: ['autorización', 'autorizacion', 'abac', 'rbac', 'permisos'], pattern: 'abac' },
    { words: ['api key', 'apikey', 'api-key'], pattern: 'api-key' },
    { words: ['oauth', 'oauth2', 'openid', 'oidc'], pattern: 'oauth2' },
    { words: ['cifrado', 'encriptación', 'hash', 'bcrypt', 'argon2'] },
    { words: ['xss', 'csrf', 'inyección', 'inyeccion', 'sql injection', 'owasp'] },
    { words: ['vulnerabilidad', 'vulnerabilidad', 'cve', 'pentest'] },
    { words: ['secrets', 'secretos', 'vault', 'hashicorp'] },
    { words: ['certificado', 'tls', 'ssl', 'https', 'mtls'] },
  ],
  resilience: [
    { words: ['circuit breaker', 'circuitbreaker', 'breaker'], pattern: 'circuit-breaker' },
    { words: ['retry', 'reintento', 'backoff', 'exponential backoff'], pattern: 'retry-backoff' },
    { words: ['bulkhead', 'aislamiento'], pattern: 'bulkhead' },
    { words: ['timeout', 'time-out', 'latency', 'latencia'] },
    { words: ['fallover', 'failover', 'alta disponibilidad', 'high availability'] },
    { words: ['resiliencia', 'resilience', 'tolerancia a fallos'] },
  ],
  messaging: [
    { words: ['rabbitmq', 'amqp', 'broker', 'cola', 'queue'], pattern: 'broker-tcp' },
    { words: ['kafka', 'evento', 'event streaming', 'topic'] },
    { words: ['sns', 'sqs', 'mensajería', 'mensajeria'] },
    { words: ['dlq', 'dead letter', 'reintento fallido'] },
    { words: ['pub/sub', 'publish', 'subscribe', 'suscripción'] },
  ],
  database: [
    { words: ['base de datos', 'bd', 'database', 'db'] },
    { words: ['mysql', 'postgresql', 'postgres', 'sql server', 'oracle'] },
    { words: ['mongodb', 'nosql', 'documento', 'colección'] },
    { words: ['redis', 'caché', 'cache', 'memcached'] },
    { words: ['elasticsearch', 'búsqueda', 'search', 'índice', 'indice'] },
    { words: ['migración', 'migracion', 'schema', 'esquema'] },
    { words: ['query', 'consulta', 'sql', 'join', 'índice', 'indice'] },
    { words: ['orm', 'prisma', 'typeorm', 'sequelize', 'drizzle'] },
  ],
  backend: [
    { words: ['backend', 'servidor', 'server-side'] },
    { words: ['api', 'rest', 'graphql', 'grpc', 'endpoint'] },
    { words: ['nestjs', 'nest', 'express', 'fastify', 'fastapi'] },
    { words: ['controlador', 'controller', 'servicio', 'service', 'repositorio'] },
    { words: ['middleware', 'interceptor', 'guard', 'pipe', 'filter'] },
    { words: ['dto', 'validator', 'validación', 'validacion', 'zod', 'class-validator'] },
    { words: ['inyección de dependencias', 'dependency injection', 'di'] },
  ],
  frontend: [
    { words: ['react', 'vue', 'angular', 'svelte', 'solid'] },
    { words: ['componente', 'component', 'hook', 'useEffect', 'useState'] },
    { words: ['ui', 'interfaz', 'usuario', 'pantalla', 'vista'] },
    { words: ['css', 'tailwind', 'estilo', 'style', 'animación'] },
    { words: ['next.js', 'nextjs', 'nuxt', 'gatsby', 'astro'] },
    { words: ['formulario', 'form', 'input', 'botón', 'boton'] },
  ],
  architecture: [
    { words: ['arquitectura', 'arquitectónico', 'arquitectonico'] },
    { words: ['ddd', 'domain driven', 'bounded context', 'agregado', 'aggregate'] },
    { words: ['microservicio', 'microservicios', 'monolito', 'modular'] },
    { words: ['event sourcing', 'cqrs', 'saga', 'outbox', 'inbox'] },
    { words: ['patrón', 'patron', 'design pattern', 'patrón de diseño'] },
    { words: ['c4', 'diagrama', 'adr', 'trade-off'] },
  ],
  testing: [
    { words: ['test', 'tests', 'testing', 'prueba', 'pruebas'] },
    { words: ['unitario', 'unit test', 'integración', 'integration', 'e2e'] },
    { words: ['jest', 'vitest', 'playwright', 'cypress', 'mocha'] },
    { words: ['tdd', 'bdd', 'cobertura', 'coverage', 'mock'] },
    { words: ['contrato', 'contract', 'pact', 'mutation'] },
  ],
  devops: [
    { words: ['docker', 'dockerfile', 'contenedor', 'container', 'imagen'] },
    { words: ['kubernetes', 'k8s', 'helm', 'pod', 'deployment', 'service'] },
    { words: ['ci/cd', 'pipeline', 'github actions', 'gitlab ci', 'jenkins'] },
    { words: ['terraform', 'pulumi', 'iac', 'infraestructura'] },
    { words: ['cloud', 'aws', 'gcp', 'azure', 'nube'] },
    { words: ['monitoreo', 'monitoring', 'prometheus', 'grafana', 'alertas'] },
  ],
};

// ── Domain Detection Result ──────────────────────────────────────────────────

export interface DomainDetectionResult {
  /** Dominios detectados, ordenados por relevancia */
  domains: string[];
  /** Servicios objetivo detectados */
  targetServices: string[];
  /** Patrones relacionados del vault */
  relatedPatterns: string[];
  /** Score de confianza por dominio */
  scores: Record<string, number>;
}

/**
 * @description Detecta dominios a partir del input del usuario.
 * 
 * Analiza el texto en busca de keywords técnicas y construye
 * un mapa de dominios con sus puntuaciones.
 * 
 * @param input - Texto del usuario
 * @returns Dominios detectados con scores
 */
function matchesKeyword(text: string, keyword: string): boolean {
  if (!keyword.includes(' ')) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(keyword.toLowerCase());
}

export function detectDomains(input: string): DomainDetectionResult {
  const lower = input.toLowerCase();
  const scores: Record<string, number> = {};
  const targetServices = new Set<string>();
  const relatedPatterns = new Set<string>();

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let total = 0;
    for (const kw of keywords) {
      for (const word of kw.words) {
        if (matchesKeyword(lower, word)) {
          total += 1;
          if (kw.service) targetServices.add(kw.service);
          if (kw.pattern) relatedPatterns.add(kw.pattern);
        }
      }
    }
    if (total > 0) {
      scores[domain] = total;
    }
  }

  // Ordenar por score descendente
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([domain]) => domain);

  return {
    domains: sorted,
    targetServices: [...targetServices],
    relatedPatterns: [...relatedPatterns],
    scores,
  };
}

/**
 * @description Enriquce un TaskContext con los dominios detectados.
 */
export function enrichTaskWithDomains(task: TaskContext): TaskContext {
  const result = detectDomains(task.rawPrompt);
  return {
    ...task,
    domains: result.domains,
    targetServices: [
      ...new Set([...task.targetServices, ...result.targetServices]),
    ],
    relatedPatterns: [
      ...new Set([...task.relatedPatterns, ...result.relatedPatterns]),
    ],
    updatedAt: new Date(),
  };
}
