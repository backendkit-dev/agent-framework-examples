import { registerSkillHandler } from '../registry';

function toPascal(s: string): string {
    return s.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^./, c => c.toUpperCase());
}

export function registerTypeScriptHandlers() {

    // ── ts_generateBrandedType ──────────────────────────────────────────────
    // args: { name: string, prefix: string }
    // Genera un branded type con factory createId() y type guard startsWith.
    registerSkillHandler('ts_generateBrandedType', async (args) => {
        const name   = toPascal(String(args.name ?? 'EntityId'));
        const prefix = String(args.prefix ?? name.toLowerCase().replace('id', '') + '_');
        return `import { brand } from '@app/shared'

const createId = <T extends string>(_brand: T) =>
  (value: string) => brand(_brand)(value)

export type ${name} = ReturnType<typeof ${name}>
export const ${name} = createId('${name}')

export const is${name} = (x: string): x is ${name} => x.startsWith('${prefix}')
`.trim();
    });

    // ── ts_generateDomainError ─────────────────────────────────────────────
    // args: { code: string, withContext?: boolean, contextParam?: string }
    // Genera una subclase concreta de DomainError con code readonly.
    registerSkillHandler('ts_generateDomainError', async (args) => {
        const code        = String(args.code ?? 'ENTITY_NOT_FOUND').toUpperCase();
        const withContext = Boolean(args.withContext ?? code.includes('NOT_FOUND'));
        const ctxParam    = String(args.contextParam ?? 'id');
        const className   = toPascal(code.replace(/_/g, ' ').toLowerCase().replace(/ ./g, m => m[1].toUpperCase())) + 'Error';

        if (withContext) {
            return `export class ${className} extends DomainError {
  readonly code = '${code}'
  readonly message: string
  constructor(${ctxParam}: string) {
    super(\`${code.replace(/_/g, ' ').toLowerCase()}: \${${ctxParam}}\`)
    this.message = \`${code.replace(/_/g, ' ').toLowerCase()}: \${${ctxParam}}\`
  }
}`.trim();
        }
        return `export class ${className} extends DomainError {
  readonly code = '${code}'
  readonly message = '${code.replace(/_/g, ' ').toLowerCase()}'
}`.trim();
    });

    // ── ts_generateValueObject ─────────────────────────────────────────────
    // args: { name: string, fields: Array<{name, type, validation?}> }
    // Genera un value object con static create() que retorna Result.
    registerSkillHandler('ts_generateValueObject', async (args) => {
        const name   = toPascal(String(args.name ?? 'ValueObject'));
        const fields: Array<{ name: string; type: string; validation?: string }> =
            Array.isArray(args.fields) ? args.fields : [{ name: 'value', type: 'string' }];

        const ctorParams  = fields.map(f => `readonly ${f.name}: ${f.type}`).join(', ');
        const createParams = fields.map(f => `${f.name}: ${f.type}`).join(', ');
        const validations = fields
            .filter(f => f.validation)
            .map(f => `    if (${f.validation}) return Result.err(new ${name}InvalidError(${JSON.stringify(f.validation)}))`)
            .join('\n');
        const ctor = fields.map(f => f.name).join(', ');

        return `export class ${name} {
  private constructor(${ctorParams}) {}

  static create(${createParams}): Result<${name}, DomainError> {
${validations || '    // TODO: add validations'}
    return Result.ok(new ${name}(${ctor}))
  }

  static from(${createParams}): ${name} {
    return new ${name}(${ctor})  // reconstitución sin validar (desde persistencia)
  }
}`.trim();
    });

    // ── ts_generateUseCase ─────────────────────────────────────────────────
    // args: { name: string, ids: string[], responseType?: string }
    // Genera un use case con combineMultipleTuple para validar IDs.
    registerSkillHandler('ts_generateUseCase', async (args) => {
        const name        = toPascal(String(args.name ?? 'CreateEntity'));
        const ids: string[] = Array.isArray(args.ids) ? args.ids : ['EntityId'];
        const responseType = String(args.responseType ?? `${name}Response`);
        const cmdType      = `${name}Command`;

        const idLines    = ids.map(id => `    ${id}(cmd.${id[0].toLowerCase() + id.slice(1).replace('Id', 'Id')}),`).join('\n');
        const idBindings = ids.map(id => id[0].toLowerCase() + id.slice(1)).join(', ');

        return `export class ${name}UseCase {
  constructor(private readonly repo: I${name.replace(/Create|Update|Delete/, '')}Repository) {}

  async execute(cmd: ${cmdType}): Promise<Result<${responseType}, DomainError>> {
    // 1. Validar IDs
    const idsResult = combineMultipleTuple(
${idLines}
    )
    if (idsResult.isFailure) return Result.err(idsResult.unwrapError())
    const [${idBindings}] = idsResult.unwrap()

    // 2. Lógica de negocio
    // TODO: agregar value objects, aggregate, etc.

    // 3. Persistir
    // const saveResult = await this.repo.save(aggregate)
    // if (saveResult.isFailure) return Result.err(saveResult.unwrapError())

    return Result.ok({ /* TODO: respuesta */ })
  }
}`.trim();
    });

    // ── ts_generateResultChain ─────────────────────────────────────────────
    // args: { steps: Array<{name: string, type: string, call: string}> }
    // Genera una cadena de Result checks estilo use case.
    registerSkillHandler('ts_generateResultChain', async (args) => {
        const steps: Array<{ name: string; type: string; call: string }> =
            Array.isArray(args.steps) ? args.steps : [];

        if (!steps.length) return '// No se especificaron pasos';

        return steps.map(step => `const ${step.name}Result = ${step.call}
if (${step.name}Result.isFailure) return Result.err(${step.name}Result.unwrapError())
const ${step.name} = ${step.name}Result.unwrap()`).join('\n\n');
    });
}
