/**
 * @description Heurísticas de código para el evaluador de respuestas.
 * Contiene whitelists de APIs conocidas, expresiones regulares y
 * métodos de verificación de imports, archivos y calidad de código.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EvaluationIssue } from './types';

// ── APIs reales de TypeScript/Node.js ────────────────────────────────────────

export const KNOWN_NODE_APIS = new Set([
  'fs', 'path', 'http', 'https', 'net', 'stream', 'crypto',
  'os', 'util', 'events', 'buffer', 'child_process', 'cluster',
  'dns', 'dgram', 'readline', 'timers', 'url', 'zlib',
  'assert', 'tls', 'string_decoder', 'punycode', 'querystring',
  'console', 'process', 'global', 'module', 'require',
  '__dirname', '__filename', 'exports', 'Buffer', 'setTimeout',
  'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
  'Reflect', 'Proxy', 'Intl', 'BigInt', 'globalThis',
]);

/** APIs reales de NestJS */
export const KNOWN_NESTJS_APIS = new Set([
  '@nestjs/common', '@nestjs/core', '@nestjs/platform-express',
  '@nestjs/testing', '@nestjs/typeorm', '@nestjs/mongoose',
  '@nestjs/graphql', '@nestjs/config', '@nestjs/jwt',
  '@nestjs/passport', '@nestjs/swagger', '@nestjs/event-emitter',
  '@nestjs/cqrs', '@nestjs/schedule', '@nestjs/microservices',
  '@nestjs/bull', '@nestjs/axios', '@nestjs/cache-manager',
  '@nestjs/throttler', '@nestjs/serve-static',
  'Controller', 'Get', 'Post', 'Put', 'Delete', 'Patch',
  'Injectable', 'Module', 'Inject', 'Optional', 'forwardRef',
  'Body', 'Param', 'Query', 'Headers', 'Req', 'Res',
  'HttpCode', 'HttpStatus', 'Redirect', 'Header',
  'UseGuards', 'UseInterceptors', 'UsePipes', 'UseFilters',
  'createParamDecorator', 'ExecutionContext', 'CallHandler',
  'NestFactory', 'NestModule', 'MiddlewareConsumer',
  'OnModuleInit', 'OnModuleDestroy', 'BeforeApplicationShutdown',
  'ModuleRef', 'Reflector', 'ArgumentsHost', 'ExceptionFilter',
  'PipeTransform', 'GuardCanActivate', 'Interceptor',
  'ValidationPipe', 'ParseIntPipe', 'ParseUUIDPipe', 'DefaultValuePipe',
  'BadRequestException', 'NotFoundException', 'UnauthorizedException',
  'ForbiddenException', 'ConflictException', 'InternalServerErrorException',
]);

/** APIs reales de Express */
export const KNOWN_EXPRESS_APIS = new Set([
  'express', 'Request', 'Response', 'NextFunction', 'Router',
  'Application', 'json', 'urlencoded', 'static', 'cookieParser',
  'cors', 'compression', 'morgan', 'helmet',
]);

/** Nombres de métodos conocidos de OpenAI/DeepSeek */
export const KNOWN_AI_API_METHODS = new Set([
  'create', 'chat', 'completions', 'embedding', 'createEmbedding',
  'stream', 'list', 'retrieve', 'del', 'update',
  'messages', 'content', 'role', 'tool_calls', 'function',
  'chat.completions.create', 'chat.completions.stream',
]);

// ── Expresiones regulares ────────────────────────────────────────────────────

/** Captura referencias a rutas de archivo dentro de bloques de código */
export const FILE_REF_REGEX = /['"`]([\w/.-]+\.(ts|js|tsx|jsx|json|yaml|yml|css|html|md))['"`]/g;

/** Captura import/require */
export const IMPORT_REGEX = /(?:from\s+['"])([^'"]+)(?:['"])|(?:require\s*\(\s*['"])([^'"]+)(?:['"]\s*\))/g;

/** Captura referencias a métodos/APIs en estilo NestJS: this.service.metodo() */
export const METHOD_CALL_REGEX = /\.([a-zA-Z]\w*)\s*\(/g;

/** Captura bloques de código */
export const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;

// ── Mapa de métodos conocidos por objeto ─────────────────────────────────────

export const KNOWN_OBJECT_METHODS: Record<string, Set<string>> = {
  // NestJS
  service: new Set([
    'findAll', 'findOne', 'findById', 'create', 'update', 'delete', 'remove',
    'save', 'find', 'findAndCount', 'count', 'exists',
    'findBy', 'findOneBy', 'findOneOrFail', 'findOneByOrFail',
    'insert', 'updateOne', 'deleteOne', 'deleteMany', 'updateMany',
    'aggregate', 'paginate', 'list', 'getAll', 'getById',
  ]),
  repository: new Set([
    'find', 'findOne', 'findById', 'save', 'create', 'update', 'delete',
    'findAndCount', 'count', 'exists', 'findBy', 'findOneBy',
    'findOneOrFail', 'findOneByOrFail', 'insert', 'updateOne',
    'deleteOne', 'deleteMany', 'updateMany', 'query', 'clear',
    'merge', 'preload', 'upsert', 'softDelete', 'restore',
    'createQueryBuilder', 'manager', 'metadata', 'target',
  ]),
  logger: new Set([
    'log', 'info', 'warn', 'error', 'debug', 'verbose', 'fatal',
  ]),
  config: new Set([
    'get', 'set', 'has', 'getOrThrow', 'getOrElse',
  ]),
  cache: new Set([
    'get', 'set', 'del', 'delete', 'has', 'clear', 'keys', 'values',
    'setEx', 'getSet', 'mGet', 'mSet', 'hGet', 'hSet', 'hDel',
    'lPush', 'rPush', 'lPop', 'rPop', 'lRange', 'sAdd', 'sMembers',
    'sIsMember', 'zAdd', 'zRange', 'zRank', 'expire', 'ttl',
  ]),
  // Express
  req: new Set([
    'body', 'params', 'query', 'headers', 'cookies', 'signedCookies',
    'ip', 'ips', 'path', 'method', 'originalUrl', 'baseUrl',
    'hostname', 'protocol', 'secure', 'xhr', 'fresh', 'stale',
    'subdomains', 'accepted', 'acceptedLanguages', 'acceptedCharsets',
    'get', 'header', 'accepts', 'acceptsLanguages', 'acceptsCharsets',
    'is', 'range', 'param', 'files', 'file', 'user', 'session',
  ]),
  res: new Set([
    'send', 'json', 'jsonp', 'status', 'sendStatus', 'redirect',
    'render', 'set', 'header', 'get', 'type', 'format', 'attachment',
    'download', 'sendFile', 'links', 'location', 'charset', 'vary',
    'cookie', 'clearCookie', 'end', 'write', 'pipe',
  ]),
  // Prisma
  prisma: new Set([
    'findUnique', 'findFirst', 'findMany', 'create', 'update', 'upsert',
    'delete', 'deleteMany', 'updateMany', 'count', 'aggregate',
    'groupBy', 'findRaw', 'aggregateRaw',
    'createMany', 'createManyAndReturn',
    '$connect', '$disconnect', '$on', '$use', '$extends',
    '$queryRaw', '$executeRaw', '$transaction', '$disconnect',
  ]),
  // axios
  axios: new Set([
    'get', 'post', 'put', 'patch', 'delete', 'head', 'options',
    'request', 'all', 'spread',
  ]),
  // fs
  fs: new Set([
    'readFile', 'readFileSync', 'writeFile', 'writeFileSync',
    'appendFile', 'appendFileSync', 'unlink', 'unlinkSync',
    'mkdir', 'mkdirSync', 'rmdir', 'rmdirSync', 'rm', 'rmSync',
    'copyFile', 'copyFileSync', 'rename', 'renameSync',
    'stat', 'statSync', 'lstat', 'lstatSync', 'exists', 'existsSync',
    'readdir', 'readdirSync', 'access', 'accessSync',
    'watch', 'watchFile', 'unwatchFile',
    'createReadStream', 'createWriteStream',
    'realpath', 'realpathSync', 'chmod', 'chmodSync',
  ]),
  path: new Set([
    'join', 'resolve', 'relative', 'dirname', 'basename', 'extname',
    'parse', 'format', 'normalize', 'isAbsolute', 'sep', 'delimiter',
  ]),
  // Lodash
  _: new Set([
    'get', 'set', 'has', 'pick', 'omit', 'merge', 'clone', 'cloneDeep',
    'assign', 'extend', 'keys', 'values', 'entries', 'fromPairs',
    'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex',
    'some', 'every', 'includes', 'isEqual', 'isEmpty', 'isNil',
    'isNull', 'isUndefined', 'isString', 'isNumber', 'isBoolean',
    'isArray', 'isObject', 'isFunction', 'isDate', 'isRegExp',
    'chunk', 'compact', 'concat', 'difference', 'drop', 'dropRight',
    'fill', 'flatten', 'flattenDeep', 'head', 'indexOf', 'initial',
    'intersection', 'join', 'last', 'lastIndexOf', 'nth', 'pull',
    'pullAll', 'pullAt', 'remove', 'reverse', 'slice', 'sortedIndex',
    'sortedUniq', 'split', 'tail', 'take', 'takeRight', 'union',
    'uniq', 'uniqBy', 'without', 'xor', 'zip', 'zipObject',
    'camelCase', 'capitalize', 'deburr', 'endsWith', 'escape',
    'escapeRegExp', 'kebabCase', 'lowerCase', 'lowerFirst',
    'pad', 'padEnd', 'padStart', 'repeat', 'replace', 'snakeCase',
    'split', 'startCase', 'startsWith', 'toLower', 'toUpper',
    'trim', 'trimEnd', 'trimStart', 'truncate', 'unescape',
    'upperCase', 'upperFirst', 'words',
  ]),
};

// ── Whitelist de paquetes npm conocidos ──────────────────────────────────────

import { KNOWN_NPM_PACKAGES } from './npm-whitelist';
export { KNOWN_NPM_PACKAGES };

// ── Funciones de verificación ────────────────────────────────────────────────

/**
 * Verifica referencias a archivos del proyecto.
 * Busca imports relativos (./ o ../) y verifica que el archivo exista.
 */
export function checkFileReferences(response: string, projectRoot: string): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const seen = new Set<string>();

  const fileRefRegex = /(?:from\s+['"]\.\.?\/|import\s+['"]\.\.?\/|require\s*\(\s*['"]\.\.?\/)([^'"]+)(?:['"])/g;

  let match: RegExpExecArray | null;
  while ((match = fileRefRegex.exec(response)) !== null) {
    const ref = match[1];
    if (seen.has(ref)) continue;
    seen.add(ref);

    const fullPath = path.resolve(projectRoot, ref);
    if (!fs.existsSync(fullPath)) {
      issues.push({
        type: 'hallucination',
        severity: 'medium',
        description: `Posible archivo inventado: "${ref}" no existe en el proyecto`,
        detail: `Ruta resuelta: ${fullPath}`,
      });
    }
  }

  return issues;
}

/**
 * Verifica imports/packages en busca de paquetes npm inventados.
 */
export function checkImports(response: string): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const seenPackages = new Set<string>();

  const importRegex = /(?:from\s+['"])([^'"]+)(?:['"])|(?:require\s*\(\s*['"])([^'"]+)(?:['"]\s*\))/g;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(response)) !== null) {
    const pkg = (match[1] || match[2]).trim();
    if (seenPackages.has(pkg)) continue;
    seenPackages.add(pkg);

    if (KNOWN_NODE_APIS.has(pkg)) continue;
    if (KNOWN_NESTJS_APIS.has(pkg)) continue;
    if (KNOWN_EXPRESS_APIS.has(pkg)) continue;

    if (pkg.startsWith('@') && pkg.includes('/')) continue;
    if (pkg.startsWith('.') || pkg.startsWith('/')) continue;
    if (KNOWN_NPM_PACKAGES.has(pkg)) continue;

    if (!pkg.includes('/') && pkg.length > 3 && !isLikelyRealNpmPackage(pkg)) {
      issues.push({
        type: 'hallucination',
        severity: 'low',
        description: `Posible paquete npm inventado: "${pkg}"`,
        detail: 'Verificar que el paquete existe en npm antes de confiar en esta respuesta',
      });
    }
  }

  return issues;
}

/**
 * Heurística para determinar si un paquete no listado probablemente existe en npm.
 */
function isLikelyRealNpmPackage(pkg: string): boolean {
  const segments = pkg.split('-');
  if (segments.length >= 4 && !KNOWN_NPM_PACKAGES.has(pkg)) return false;
  if (segments.length === 1 && pkg.length < 4) return false;
  return true;
}

/**
 * Verifica APIs inventadas en bloques de código.
 * Busca patrones sospechosos: this.obj.method(), cualquier obj.veryLongMethod().
 */
export function checkInventedApis(response: string): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const seenMethods = new Set<string>();

  const codeRegex = /```(?:typescript|javascript|js|ts)?\n([\s\S]*?)```/g;

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = codeRegex.exec(response)) !== null) {
    const code = blockMatch[1];
    let methodMatch: RegExpExecArray | null;

    // Pattern 1: this.obj.method(
    const thisPattern = /this\.(\w+)\.(\w+)\s*\(/g;
    while ((methodMatch = thisPattern.exec(code)) !== null) {
      const objectName = methodMatch[1];
      const methodName = methodMatch[2];

      if (isKnownMethod(objectName, methodName)) continue;

      const key = `${objectName}.${methodName}`;
      if (seenMethods.has(key)) continue;
      seenMethods.add(key);

      if (methodName.length > 25) {
        issues.push({
          type: 'hallucination',
          severity: 'medium',
          description: `Posible método inventado: "${key}"`,
          detail: `El nombre del método (${methodName.length} caracteres) es inusualmente largo`,
        });
      }
    }

    // Pattern 2: obj.longMethod( — any variable (not just this.x)
    // Lookbehind excludes matches already inside `this.x.y(` chains
    const anyObjPattern = /(?<!\w)(\w+)\.(\w{4,})\s*\(/g;
    while ((methodMatch = anyObjPattern.exec(code)) !== null) {
      const objectName = methodMatch[1];
      const methodName = methodMatch[2];

      if (objectName === 'this') continue;
      if (isKnownMethod(objectName, methodName)) continue;
      if (KNOWN_NODE_APIS.has(objectName)) continue;

      const key = `${objectName}.${methodName}`;
      if (seenMethods.has(key)) continue;
      seenMethods.add(key);

      if (methodName.length > 25) {
        issues.push({
          type: 'hallucination',
          severity: 'low',
          description: `Posible método inventado: "${key}"`,
          detail: `El nombre del método (${methodName.length} caracteres) es inusualmente largo`,
        });
      }
    }
  }

  return issues;
}

/**
 * Verifica si un método es conocido para un objeto dado.
 */
export function isKnownMethod(objectName: string, methodName: string): boolean {
  const methods = KNOWN_OBJECT_METHODS[objectName];
  if (!methods) return false;
  return methods.has(methodName);
}

/**
 * Verifica coherencia con el historial de la conversación.
 */
export function checkCoherence(response: string, history: Message[]): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];

  const recentMessages = history.slice(-6);
  const historyTopics = new Set<string>();

  for (const msg of recentMessages) {
    if (typeof msg.content === 'string') {
      const words = msg.content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) ?? [];
      for (const word of words) {
        if (word.length > 3) historyTopics.add(word.toLowerCase());
      }
    }
  }

  if (historyTopics.size > 0) {
    const responseLower = response.toLowerCase();
    const responseWords = new Set(responseLower.split(/\s+/).filter(w => w.length > 3));

    const shared = [...historyTopics].filter(t => responseWords.has(t));
    if (shared.length === 0 && recentMessages.length >= 4) {
      issues.push({
        type: 'coherence',
        severity: 'low',
        description: 'La respuesta no parece relacionada con la conversación reciente',
        detail: `Temas del historial: ${[...historyTopics].slice(0, 5).join(', ')}`,
      });
    }
  }

  return issues;
}

// Import necesario para checkCoherence
import { Message } from '../../api/types';

/**
 * Verifica la calidad del código en bloques de código.
 */
export function checkCodeQuality(response: string): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];

  const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(response)) !== null) {
    const lang = match[1];
    const code = match[2];
    const lines = code.split('\n');

    // Bloques vacíos
    if (lines.filter(l => l.trim()).length === 0) {
      issues.push({
        type: 'quality',
        severity: 'medium',
        description: `Bloque de código ${lang ? lang : 'sin lenguaje'} vacío`,
      });
      continue;
    }

    // Código solo comentarios
    const nonCommentLines = lines.filter(
      l => !l.trim().startsWith('//') && !l.trim().startsWith('/*') && !l.trim().startsWith('*') && l.trim()
    );
    if (nonCommentLines.length === 0 && lines.length > 2) {
      issues.push({
        type: 'quality',
        severity: 'low',
        description: 'Bloque de código contiene solo comentarios, sin implementación real',
      });
    }

    // TODOs y FIXMEs
    const todoLines = lines.filter(l => l.includes('// TODO') || l.includes('// FIXME') || l.includes('// HACK'));
    for (const todoLine of todoLines) {
      issues.push({
        type: 'quality',
        severity: 'medium',
        description: `Código contiene marcadores pendientes: "${todoLine.trim()}"`,
        detail: 'Los TODOs en código generado indican implementación incompleta',
      });
    }

    // console.log en producción
    if (lang === 'typescript' || lang === 'javascript' || lang === 'js' || lang === 'ts') {
      const consoleLogLines = lines.filter(l => l.includes('console.log'));
      if (consoleLogLines.length > 0) {
        issues.push({
          type: 'quality',
          severity: 'low',
          description: `Código contiene ${consoleLogLines.length} console.log que deberían eliminarse en producción`,
        });
      }
    }

    // TypeScript con 'any'
    if (lang === 'typescript' || lang === 'ts') {
      const anyCount = (code.match(/\bany\b/g) ?? []).length;
      if (anyCount > 0) {
        issues.push({
          type: 'quality',
          severity: 'low',
          description: `Código TypeScript usa 'any' ${anyCount} vez/veces — preferir tipos concretos`,
        });
      }
    }
  }

  return issues;
}

/**
 * Calcula la penalización según la severidad del issue.
 */
export function severityPenalty(severity: EvaluationIssue['severity']): number {
  switch (severity) {
    case 'critical': return 30;
    case 'high':     return 20;
    case 'medium':   return 10;
    case 'low':      return 5;
    default:         return 0;
  }
}
