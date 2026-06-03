import * as fs from 'fs/promises';
import * as path from 'path';
import { registerSkillHandler } from '../registry';

function capitalize(s: string) { return s[0].toUpperCase() + s.slice(1); }

const PROJECT_ROOT = process.cwd();

function sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '').replace(/\.\./g, '');
}

function isInsideProject(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return resolved.startsWith(path.resolve(PROJECT_ROOT) + path.sep) || resolved === path.resolve(PROJECT_ROOT);
}

async function ensureDir(dir: string): Promise<string | null> {
    if (!isInsideProject(dir)) return 'Acceso denegado: directorio fuera del proyecto';
    await fs.mkdir(dir, { recursive: true });
    return null;
}

export function registerNestJSHandlers() {

    registerSkillHandler('nestjs.generateModule', async (args) => {
        const raw = args.module_name as string;
        const moduleName = sanitizeName(raw);
        if (!moduleName || moduleName !== raw) {
            return `Nombre de modulo invalido: "${raw}". Solo se permiten letras, numeros, guiones y guiones bajos.`;
        }
        const entities = (args.entities as string)?.split(',').map(e => sanitizeName(e.trim())).filter(Boolean) || [];
        const dir = path.join(PROJECT_ROOT, 'src', moduleName);
        const err = await ensureDir(dir);
        if (err) return err;

        let mod = `import { Module } from '@nestjs/common';\n`;
        if (entities.length) mod += `import { TypeOrmModule } from '@nestjs/typeorm';\nimport { ${entities.map(capitalize).join(', ')} } from './entities';\n`;
        mod += `\n@Module({\n  imports: [${entities.length ? `TypeOrmModule.forFeature([${entities.map(capitalize).join(', ')}])` : ''}],\n  controllers: [${capitalize(moduleName)}Controller],\n  providers: [${capitalize(moduleName)}Service],\n  exports: [${capitalize(moduleName)}Service],\n})\nexport class ${capitalize(moduleName)}Module {}\n`;
        await fs.writeFile(path.join(dir, `${moduleName}.module.ts`), mod);
        await fs.writeFile(path.join(dir, `${moduleName}.controller.ts`), `import { Controller } from '@nestjs/common';\n@Controller('${moduleName}')\nexport class ${capitalize(moduleName)}Controller {}\n`);
        await fs.writeFile(path.join(dir, `${moduleName}.service.ts`), `import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class ${capitalize(moduleName)}Service {}\n`);

        if (entities.length) {
            const entDir = path.join(dir, 'entities');
            await ensureDir(entDir);
            for (const e of entities) {
                await fs.writeFile(path.join(entDir, `${e}.entity.ts`), `import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';\n@Entity('${e}')\nexport class ${capitalize(e)} {\n  @PrimaryGeneratedColumn() id: number;\n  @Column() name: string;\n}\n`);
            }
            await fs.writeFile(path.join(entDir, 'index.ts'), entities.map(e => `export { ${capitalize(e)} } from './${e}.entity';`).join('\n'));
        }
        return `Modulo ${moduleName} generado en src/${moduleName}/`;
    });

    registerSkillHandler('nestjs.generateResultService', async (args) => {
        const raw = args.module_name as string;
        const moduleName = sanitizeName(raw);
        if (!moduleName || moduleName !== raw) return `Nombre invalido: "${raw}"`;
        const entityType = sanitizeName((args.entity_type as string) || 'Entity');
        const dir = path.join(PROJECT_ROOT, 'src', moduleName);
        const err = await ensureDir(dir);
        if (err) return err;

        const C = capitalize(moduleName);
        const E = capitalize(entityType);
        const content = `import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@backendkit-labs/result';
import { BkLogger } from '@backendkit-labs/observability';

export type ${C}Error = 'NOT_FOUND' | 'CONFLICT' | 'DB_ERROR';

@Injectable()
export class ${C}Service {
  constructor(private readonly logger: BkLogger) {}

  async findById(id: string): Promise<Result<${E}, ${C}Error>> {
    this.logger.info('findById', { id });
    try {
      // TODO: reemplaza con tu repositorio
      const entity: ${E} | null = null;
      if (!entity) return err('NOT_FOUND');
      return ok(entity);
    } catch (error) {
      this.logger.error('Error en findById', { id, error });
      return err('DB_ERROR');
    }
  }

  async create(dto: Partial<${E}>): Promise<Result<${E}, ${C}Error>> {
    this.logger.info('create', { dto });
    try {
      // TODO: reemplaza con tu repositorio
      const entity = dto as ${E};
      return ok(entity);
    } catch (error) {
      this.logger.error('Error en create', { error });
      return err('DB_ERROR');
    }
  }
}
`;
        await fs.writeFile(path.join(dir, `${moduleName}.service.ts`), content);
        return `Service con Result generado en src/${moduleName}/${moduleName}.service.ts`;
    });

    registerSkillHandler('nestjs.generateObservabilityModule', async (_args) => {
        const appModulePath = path.join(PROJECT_ROOT, 'src', 'app.module.ts');
        let appModule: string;
        try {
            appModule = await fs.readFile(appModulePath, 'utf-8');
        } catch {
            return 'No se encontro src/app.module.ts. Crea el modulo manualmente.';
        }

        if (appModule.includes('ObservabilityModule')) {
            return 'ObservabilityModule ya esta configurado en app.module.ts';
        }

        const withImport = `import { ObservabilityModule } from '@backendkit-labs/observability';\n` + appModule;
        const withModule = withImport.replace(
            /imports\s*:\s*\[/,
            `imports: [\n    ObservabilityModule.forRoot({\n      serviceName: process.env.SERVICE_NAME || 'app',\n      logLevel: process.env.LOG_LEVEL || 'info',\n      correlationId: { enabled: true, header: 'x-correlation-id' },\n    }),`,
        );
        await fs.writeFile(appModulePath, withModule);

        const mainPath = path.join(PROJECT_ROOT, 'src', 'main.ts');
        try {
            let main = await fs.readFile(mainPath, 'utf-8');
            if (!main.includes('BkExceptionFilter') && !main.includes('CorrelationIdInterceptor')) {
                main = `import { BkExceptionFilter } from '@backendkit-labs/observability';\nimport { CorrelationIdInterceptor } from '@backendkit-labs/observability';\n` + main;
                main = main.replace(
                    /app\.listen/,
                    `app.useGlobalFilters(new BkExceptionFilter());\n  app.useGlobalInterceptors(new CorrelationIdInterceptor());\n  app.listen`,
                );
                await fs.writeFile(mainPath, main);
            }
        } catch { /* main.ts opcional */ }

        return `ObservabilityModule configurado. Instala: npm install @backendkit-labs/observability`;
    });

    registerSkillHandler('nestjs.generateHttpClientModule', async (args) => {
        const raw = args.module_name as string;
        const moduleName = sanitizeName(raw || 'http-client');
        const baseUrl = (args.base_url as string) || 'process.env.EXTERNAL_API_URL';
        const dir = path.join(PROJECT_ROOT, 'src', moduleName);
        const err = await ensureDir(dir);
        if (err) return err;

        const content = `import { Module } from '@nestjs/common';
import { HttpClientModule } from '@backendkit-labs/http-client/nestjs';

@Module({
  imports: [
    HttpClientModule.forRoot({
      baseURL: ${baseUrl.startsWith('process') ? baseUrl : `'${baseUrl}'`},
      timeout: 5_000,
      retry: { attempts: 3, backoff: 'exponential' },
      circuitBreaker: {
        failureThreshold: 5,
        timeout: 10_000,
        isFailure: (error: { status?: number }) =>
          !error.status || error.status >= 500 || error.status === 429,
      },
    }),
  ],
  exports: [HttpClientModule],
})
export class ${capitalize(moduleName)}Module {}
`;
        await fs.writeFile(path.join(dir, `${moduleName}.module.ts`), content);
        return `HttpClientModule generado en src/${moduleName}/. Instala: npm install @backendkit-labs/http-client`;
    });

    registerSkillHandler('nestjs.generatePipelineUseCase', async (args) => {
        const raw = args.use_case_name as string;
        const useCaseName = sanitizeName(raw);
        if (!useCaseName || useCaseName !== raw) return `Nombre invalido: "${raw}"`;
        const dir = path.join(PROJECT_ROOT, 'src', 'use-cases');
        const err = await ensureDir(dir);
        if (err) return err;

        const C = capitalize(useCaseName);
        const content = `import { Injectable } from '@nestjs/common';
import { Pipeline, PipelineStep } from '@backendkit-labs/pipeline';
import { ok, err, Result } from '@backendkit-labs/result';
import { BkLogger } from '@backendkit-labs/observability';

interface ${C}Input { [key: string]: unknown; }
interface ${C}Output { [key: string]: unknown; }
type ${C}Error = 'VALIDATION_ERROR' | 'BUSINESS_ERROR' | 'UNEXPECTED_ERROR';

@Injectable()
export class ${C}UseCase {
  private readonly pipeline: Pipeline<${C}Input, ${C}Output>;

  constructor(private readonly logger: BkLogger) {
    this.pipeline = Pipeline.create<${C}Input, ${C}Output>()
      .pipe(this.validateStep.bind(this))
      .pipe(this.processStep.bind(this));
  }

  async execute(input: ${C}Input): Promise<Result<${C}Output, ${C}Error>> {
    this.logger.info('${useCaseName}.execute', { input });
    return this.pipeline.run(input);
  }

  private async validateStep(input: ${C}Input): Promise<Result<${C}Input, ${C}Error>> {
    if (!input) return err('VALIDATION_ERROR');
    return ok(input);
  }

  private async processStep(input: ${C}Input): Promise<Result<${C}Output, ${C}Error>> {
    return ok(input as unknown as ${C}Output);
  }
}
`;
        await fs.writeFile(path.join(dir, `${useCaseName}.use-case.ts`), content);
        return `UseCase con Pipeline generado en src/use-cases/${useCaseName}.use-case.ts. Instala: npm install @backendkit-labs/pipeline @backendkit-labs/result`;
    });

    registerSkillHandler('nestjs.generateSecurityMiddleware', async (_args) => {
        const appModulePath = path.join(PROJECT_ROOT, 'src', 'app.module.ts');
        let appModule: string;
        try {
            appModule = await fs.readFile(appModulePath, 'utf-8');
        } catch {
            return 'No se encontro src/app.module.ts.';
        }

        if (appModule.includes('RequestScannerModule')) {
            return 'RequestScannerModule ya esta configurado en app.module.ts';
        }

        const withImport = `import { RequestScannerModule } from '@backendkit-labs/request-scanner/nestjs';\n` + appModule;
        const withModule = withImport.replace(
            /imports\s*:\s*\[/,
            `imports: [\n    RequestScannerModule.forRoot({\n      patterns: ['sqli', 'xss', 'path-traversal', 'command-injection', 'nosql-injection', 'ssrf'],\n      action: 'both',\n      excludePaths: ['/health', '/metrics'],\n    }),`,
        );
        await fs.writeFile(appModulePath, withModule);

        const npmrcPath = path.join(PROJECT_ROOT, '.npmrc');
        const registryLine = '@backendkit-labs:registry=https://npm.pkg.github.com';
        try {
            const npmrc = await fs.readFile(npmrcPath, 'utf-8');
            if (!npmrc.includes(registryLine)) {
                await fs.writeFile(npmrcPath, npmrc.trimEnd() + '\n' + registryLine + '\n');
            }
        } catch {
            await fs.writeFile(npmrcPath, registryLine + '\n');
        }

        return `RequestScannerModule configurado y .npmrc actualizado.\nInstala: npm install @backendkit-labs/request-scanner`;
    });
}
