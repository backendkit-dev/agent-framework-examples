/**
 * @description InicializaciÃ³n idempotente de ~/\.bk-agent/ y de los archivos
 * de configuraciÃ³n del proyecto actual (AGENT.md).
 *
 * Se ejecuta al arrancar la CLI. Crea directorios y archivos solo si no existen;
 * nunca sobreescribe configuraciÃ³n existente.
 *
 * Archivos que gestiona:
 * - ~/\.bk-agent/USER.md          â€” preferencias globales del desarrollador
 * - ~/\.bk-agent/projects/{hash}/ â€” directorio del proyecto (pesos de routing, etc.)
 * - <cwd>/AGENT.md                    â€” configuraciÃ³n del proyecto (si no existe)
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { cwdToProjectKey, getGlobalAgentsDir, getGlobalSkillsDir } from './memory-loader';
import { BUILTIN_SKILLS } from '../skills/builtin';

export interface SeedResult {
    createdUserMd: boolean;
    createdAgentMd: boolean;
    createdDirs: string[];
}

// â”€â”€ SeÃ±ales del proyecto detectadas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ProjectSignals {
    type: string;
    runtime: string;
    stack: string[];
    buildTool: string;
    testFramework: string;
    structure: string;
    conventions: string[];
    antiPatterns: string[];
    agentScores: { id: string; score: number; reason: string }[];
    extraNotes: string[];
}

// â”€â”€ Utilidades â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
}

async function readJsonField(filePath: string, field: string): Promise<Record<string, any>> {
    try {
        const raw  = await fs.readFile(filePath, 'utf-8');
        const json = JSON.parse(raw);
        return json[field] ?? {};
    } catch {
        return {};
    }
}

// â”€â”€ DetecciÃ³n de tipo de proyecto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function detectProjectType(cwd: string): Promise<ProjectSignals> {

    // â”€â”€ Android / Kotlin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (await fileExists(path.join(cwd, 'build.gradle.kts')) ||
        await fileExists(path.join(cwd, 'build.gradle'))) {

        const isAndroid = await fileExists(
            path.join(cwd, 'app', 'src', 'main', 'AndroidManifest.xml')
        );

        if (isAndroid) {
            return {
                type: 'android',
                runtime: 'Android SDK 34, minSdk 26',
                stack: ['Kotlin', 'Jetpack Compose', 'ViewModel', 'Hilt'],
                buildTool: 'Gradle (Kotlin DSL)',
                testFramework: 'JUnit4 + Espresso + MockK',
                structure: `app/
  src/
    main/
      java/com.example/
        ui/          â€” Composables y ViewModels
        domain/      â€” casos de uso e interfaces
        data/        â€” repositorios e implementaciones
    test/            â€” unit tests
    androidTest/     â€” tests de integraciÃ³n`,
                conventions: [
                    'Sealed classes para estados de UI (Loading / Success / Error)',
                    'Coroutines + Flow para operaciones asÃ­ncronas â€” nunca callbacks ni RxJava',
                    'ViewModel nunca importa clases de Android (solo `ViewModel` base)',
                    'InyecciÃ³n de dependencias con Hilt â€” no usar constructores manuales en prod',
                    'Strings en `res/values/strings.xml` â€” nunca hardcodeadas en Composables',
                ],
                antiPatterns: [
                    'NO bloquear el main thread â€” toda I/O en `Dispatchers.IO`',
                    'NO usar `GlobalScope` â€” siempre `viewModelScope` o `lifecycleScope`',
                    'NO mutable state compartido entre ViewModels â€” pasar datos por el repositorio',
                    'NO lÃ³gica de negocio en Composables â€” delegarla al ViewModel',
                    'NO `!!` (non-null assertion) â€” usar `?: return` o sealed class de error',
                ],
                agentScores: [
                    { id: 'android-agent',  score: 1.8, reason: 'Especializado en Kotlin/Android/Jetpack' },
                    { id: 'backend-agent',  score: 0.3, reason: 'No aplica â€” proyecto mobile sin backend' },
                    { id: 'frontend-agent', score: 0.3, reason: 'No aplica â€” UI es Compose, no web' },
                ],
                extraNotes: [
                    'Actualizar `minSdk` y `targetSdk` en `app/build.gradle.kts` con los valores reales',
                    'Si usÃ¡s Room, Retrofit u otras libs, agregarlas en la secciÃ³n Stack',
                ],
            };
        }

        return {
            type: 'kotlin-jvm',
            runtime: 'JVM 17',
            stack: ['Kotlin', 'JVM'],
            buildTool: 'Gradle (Kotlin DSL)',
            testFramework: 'JUnit5 + MockK + Kotest',
            structure: `src/
  main/kotlin/     â€” cÃ³digo fuente
  test/kotlin/     â€” tests
build.gradle.kts`,
            conventions: [
                'Data classes para DTOs y value objects â€” no usar `@Data` de Java',
                'Extension functions para evitar utils classes estÃ¡ticas',
                'Coroutines para concurrencia â€” no `CompletableFuture` ni `Thread`',
                'Result<T> o sealed class para errores â€” no excepciones como control flow',
            ],
            antiPatterns: [
                'NO `!!` (non-null assertion) en cÃ³digo de producciÃ³n',
                'NO mezclar Java y Kotlin en el mismo mÃ³dulo salvo integraciÃ³n puntual',
                'NO `apply plugin` (Groovy) â€” usar plugins block de Kotlin DSL',
            ],
            agentScores: [
                { id: 'backend-agent',  score: 1.6, reason: 'Aplica para lÃ³gica de dominio y servicios' },
                { id: 'android-agent',  score: 0.5, reason: 'Parcialmente aplica â€” solo la parte Kotlin pura' },
            ],
            extraNotes: [
                'Indicar si es una librerÃ­a, microservicio o monolito',
                'Agregar el framework principal (Ktor, Spring Boot, etc.)',
            ],
        };
    }

    // â”€â”€ Rust â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (await fileExists(path.join(cwd, 'Cargo.toml'))) {
        return {
            type: 'rust',
            runtime: 'Rust (stable)',
            stack: ['Rust'],
            buildTool: 'Cargo',
            testFramework: 'cargo test + criterion (benchmarks)',
            structure: `src/
  main.rs / lib.rs
  module_a/
    mod.rs
tests/         â€” integration tests
benches/       â€” benchmarks con criterion`,
            conventions: [
                'Propagar errores con `?` â€” nunca `.unwrap()` en cÃ³digo de producciÃ³n',
                'Tipos de error con `thiserror` â€” no `Box<dyn Error>` en APIs pÃºblicas',
                'Derivar `Debug`, `Clone`, `PartialEq` en structs de datos cuando aplique',
                'Clippy en CI sin warnings â€” `#[allow(...)]` solo con comentario justificado',
                'Lifetimes explÃ­citos solo cuando el compilador no puede inferirlos',
            ],
            antiPatterns: [
                'NO `.unwrap()` o `.expect()` salvo en tests o main() con mensaje claro',
                'NO `.clone()` para evitar problemas de ownership â€” revisar el diseÃ±o',
                'NO `unsafe` sin comentario detallado del invariante que se mantiene',
                'NO `std::thread::sleep` en async â€” usar `tokio::time::sleep`',
            ],
            agentScores: [
                { id: 'backend-agent', score: 1.5, reason: 'Aplica para servicios y lÃ³gica de dominio' },
                { id: 'general',       score: 1.0, reason: 'Fallback para preguntas generales' },
            ],
            extraNotes: [
                'Indicar la edition de Rust (2021 recomendada)',
                'Agregar los crates principales (tokio, serde, axum, etc.)',
            ],
        };
    }

    // â”€â”€ Python â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (await fileExists(path.join(cwd, 'pyproject.toml')) ||
        await fileExists(path.join(cwd, 'requirements.txt'))) {

        const hasFastAPI = await fileExists(path.join(cwd, 'pyproject.toml'))
            ? (await fs.readFile(path.join(cwd, 'pyproject.toml'), 'utf-8').catch(() => '')).includes('fastapi')
            : false;

        return {
            type: 'python',
            runtime: 'Python 3.11+',
            stack: hasFastAPI ? ['Python', 'FastAPI', 'Pydantic'] : ['Python'],
            buildTool: 'pip + venv / poetry / uv',
            testFramework: 'pytest + pytest-asyncio',
            structure: `src/
  app/
    api/         â€” routers / endpoints
    domain/      â€” lÃ³gica de negocio
    infra/       â€” repositorios, clientes externos
tests/
  unit/
  integration/`,
            conventions: [
                'Type hints obligatorios en todas las funciones pÃºblicas',
                'Pydantic para validaciÃ³n de entrada y salida â€” no `dict` sueltos',
                'Excepciones especÃ­ficas â€” nunca `except Exception` sin re-raise',
                'Async/await para I/O â€” nunca `requests` en cÃ³digo async (usar `httpx`)',
                'f-strings para interpolaciÃ³n â€” no `.format()` ni `%`',
            ],
            antiPatterns: [
                'NO `bare except:` â€” siempre capturar el tipo de excepciÃ³n especÃ­fico',
                'NO variables globales mutables â€” usar inyecciÃ³n de dependencias',
                'NO imports circulares â€” reorganizar en capas si aparecen',
                'NO `print()` para logging â€” usar `logging` o `structlog`',
            ],
            agentScores: [
                { id: 'backend-agent',  score: 1.6, reason: 'Aplica para APIs y servicios Python' },
                { id: 'frontend-agent', score: 0.4, reason: 'Poco aplica salvo templates Jinja' },
            ],
            extraNotes: [
                'Indicar versiÃ³n exacta de Python (ej: 3.11.5)',
                'Completar el framework: FastAPI, Django, Flask, Celery, etc.',
            ],
        };
    }

    // â”€â”€ Go â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (await fileExists(path.join(cwd, 'go.mod'))) {
        return {
            type: 'go',
            runtime: 'Go 1.22+',
            stack: ['Go'],
            buildTool: 'go build / go tool',
            testFramework: 'go test (stdlib) + testify',
            structure: `cmd/
  app/          â€” punto de entrada
internal/
  domain/       â€” entidades y lÃ³gica de negocio
  handler/      â€” HTTP handlers
  repository/   â€” acceso a datos
pkg/            â€” paquetes reutilizables exportables`,
            conventions: [
                'Retornar `(T, error)` â€” nunca panic en cÃ³digo de librerÃ­a',
                'Tests con tabla de casos (`[]struct{ name, input, want }`) â€” table-driven tests',
                'Interfaces pequeÃ±as (1-2 mÃ©todos) â€” no interfaces de 10 mÃ©todos',
                'Contexto como primer parÃ¡metro en funciones que hacen I/O',
                'Errores envueltos con `fmt.Errorf("operaciÃ³n: %w", err)` para trazabilidad',
            ],
            antiPatterns: [
                'NO `panic()` en cÃ³digo de librerÃ­a â€” solo en `main()` con mensaje claro',
                'NO goroutine sin mecanismo de cancelaciÃ³n o WaitGroup',
                'NO `interface{}` / `any` cuando el tipo concreto es conocido',
                'NO imports de paquetes `internal/` entre mÃ³dulos separados',
            ],
            agentScores: [
                { id: 'backend-agent', score: 1.6, reason: 'Aplica para microservicios y CLIs Go' },
                { id: 'general',       score: 1.0, reason: 'Fallback para preguntas generales' },
            ],
            extraNotes: [
                'Indicar la versiÃ³n de Go del go.mod',
                'Agregar el framework HTTP si lo usÃ¡s (chi, gin, echo, etc.)',
            ],
        };
    }

    // â”€â”€ Java / Maven â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (await fileExists(path.join(cwd, 'pom.xml'))) {
        return {
            type: 'java-maven',
            runtime: 'Java 21 (LTS)',
            stack: ['Java', 'Spring Boot'],
            buildTool: 'Maven',
            testFramework: 'JUnit5 + Mockito + AssertJ',
            structure: `src/
  main/java/com.example/
    controller/   â€” REST controllers
    service/      â€” lÃ³gica de negocio
    repository/   â€” JPA repos
    domain/       â€” entidades y DTOs
  test/java/`,
            conventions: [
                '`Optional<T>` para retornos que pueden ser null â€” nunca retornar null directo',
                'Records de Java 17+ para DTOs inmutables â€” no Lombok `@Data` en nuevos DTOs',
                'Stream API para colecciones â€” no for-loops imperativos salvo rendimiento crÃ­tico',
                'Excepciones de negocio extienden `RuntimeException` con mensaje claro',
                'Transacciones en capa de servicio con `@Transactional` â€” nunca en controllers',
            ],
            antiPatterns: [
                'NO lÃ³gica de negocio en controllers â€” solo validaciÃ³n de request y delegaciÃ³n',
                'NO excepciones checked como control flow â€” usar Result pattern o Optional',
                'NO `System.out.println` en cÃ³digo de producciÃ³n â€” usar SLF4J',
                'NO `@Autowired` en campos â€” inyecciÃ³n por constructor siempre',
            ],
            agentScores: [
                { id: 'backend-agent', score: 1.8, reason: 'Especializado en backends JVM/Spring' },
                { id: 'general',       score: 1.0, reason: 'Fallback para preguntas generales' },
            ],
            extraNotes: [
                'Actualizar la versiÃ³n de Java (17, 21, etc.)',
                'Agregar librerÃ­as principales: Spring Data JPA, Spring Security, etc.',
            ],
        };
    }

    // â”€â”€ Rush monorepo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (await fileExists(path.join(cwd, 'rush.json'))) {
        return {
            type: 'rush-monorepo',
            runtime: 'Node.js 20 LTS (Rush monorepo)',
            stack: ['TypeScript', 'Rush', 'PNPM'],
            buildTool: 'rush build',
            testFramework: 'rush test (por paquete)',
            structure: `common/
  config/rush/   â€” configuracion central de Rush
  autoinstallers/
apps/            â€” aplicaciones desplegables
libs/            â€” paquetes compartidos internos
rush.json        â€” definicion del monorepo`,
            conventions: [
                'rush add / rush install â€” nunca npm/yarn/pnpm directo en la raiz',
                'Cada paquete tiene su propio tsconfig.json que extiende el comun',
                'Dependencias entre paquetes via workspace: protocol en package.json',
                'rush build --to <paquete> para builds incrementales',
                'Cambios en libs requieren bump de version antes de publicar',
            ],
            antiPatterns: [
                'NO npm install en la raiz â€” siempre rush install',
                'NO importar entre paquetes por ruta relativa â€” usar el nombre del paquete',
                'NO modificar node_modules manualmente â€” dejar que Rush los gestione',
                'NO scripts de build custom que salteen rush build â€” romperia el cache incremental',
            ],
            agentScores: [
                { id: 'backend-agent',    score: 1.4, reason: 'Aplica para paquetes backend del monorepo' },
                { id: 'frontend-agent',   score: 1.4, reason: 'Aplica para paquetes frontend del monorepo' },
                { id: 'typescript-agent', score: 1.6, reason: 'Tipado compartido entre paquetes es critico en Rush' },
            ],
            extraNotes: [
                'Listar los paquetes principales del monorepo en la seccion Estructura',
                'Indicar si se usa Heft como build tool dentro de Rush',
            ],
        };
    }

    // â”€â”€ Node.js / TypeScript / JavaScript â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const pkgPath = path.join(cwd, 'package.json');
    if (await fileExists(pkgPath)) {
        const devDeps = await readJsonField(pkgPath, 'devDependencies');
        const deps    = await readJsonField(pkgPath, 'dependencies');
        const all     = { ...devDeps, ...deps };

        const isTS     = 'typescript' in all || 'ts-node' in all || 'ts-jest' in all;
        const isNext   = 'next'         in all;
        const isNest   = '@nestjs/core' in all;
        const isReact  = 'react'        in all && !isNext;
        const isVite   = 'vite'         in all;
        const isExpress = 'express'     in all;

        const testFw =
            'jest' in all || 'ts-jest' in all ? 'Jest + ts-jest' :
            'vitest' in all                   ? 'Vitest'         :
            'mocha'  in all                   ? 'Mocha + Chai'   : 'Jest (configurar)';

        // â”€â”€ NestJS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (isNest) {
            return {
                type: 'nestjs',
                runtime: 'Node.js 20 LTS',
                stack: [isTS ? 'TypeScript' : 'JavaScript', 'NestJS'],
                buildTool: 'npm + @nestjs/cli',
                testFramework: testFw,
                structure: `src/
  app.module.ts
  main.ts
  modules/
    users/
      users.controller.ts
      users.service.ts
      users.module.ts
      dto/
      entities/
test/
  e2e/`,
                conventions: [
                    'LÃ³gica de negocio en Services â€” Controllers solo reciben, delegan y responden',
                    'DTOs con `class-validator` para validaciÃ³n de entrada â€” nunca acceder a `body` sin validar',
                    'Un mÃ³dulo por dominio de negocio â€” no mÃ³dulos tÃ©cnicos (ej: "database.module")',
                    'InyecciÃ³n de dependencias por constructor â€” nunca instanciar servicios con `new`',
                    'Excepciones HTTP con `HttpException` o sus subclases â€” no `throw new Error()` en controllers',
                ],
                antiPatterns: [
                    'NO lÃ³gica en Controllers â€” solo `this.service.mÃ©todo(dto)` y retorno',
                    'NO `any` explÃ­cito â€” usar tipos o generics',
                    'NO importar el mÃ³dulo `AppModule` desde otros mÃ³dulos',
                    'NO queries directas a base de datos en Controllers o Services (usar repositorios)',
                ],
                agentScores: [
                    { id: 'backend-agent',    score: 1.8, reason: 'Especializado en backends Node/TypeScript' },
                    { id: 'typescript-agent', score: 1.5, reason: 'Aplica para tipado y arquitectura TS' },
                    { id: 'frontend-agent',   score: 0.3, reason: 'No aplica â€” proyecto backend' },
                ],
                extraNotes: [],
            };
        }

        // â”€â”€ Next.js â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (isNext) {
            return {
                type: 'nextjs',
                runtime: 'Node.js 20 LTS',
                stack: [isTS ? 'TypeScript' : 'JavaScript', 'Next.js 14', 'React'],
                buildTool: 'npm + next build',
                testFramework: testFw,
                structure: `app/
  layout.tsx
  page.tsx
  (route-group)/
    page.tsx
components/
  ui/           â€” componentes genÃ©ricos reutilizables
  features/     â€” componentes de dominio especÃ­fico
lib/            â€” utilidades y clientes
public/`,
                conventions: [
                    'Server Components por defecto â€” agregar `"use client"` solo cuando necesite estado o eventos',
                    'Datos en Server Components con `fetch` directo â€” no `useEffect` para datos iniciales',
                    'Rutas de API en `app/api/` como Route Handlers â€” no `pages/api/`',
                    'Estilos con Tailwind CSS o CSS Modules â€” no estilos inline salvo calculados',
                    'ImÃ¡genes siempre con `next/image` â€” nunca `<img>` directo',
                ],
                antiPatterns: [
                    'NO `"use client"` en componentes raÃ­z â€” contamina el Ã¡rbol de Server Components',
                    'NO `useEffect` para fetching inicial â€” usar Server Components o React Query',
                    'NO secretos en variables `NEXT_PUBLIC_*` â€” solo para valores pÃºblicos seguros',
                    'NO `router.push` para navegaciÃ³n estÃ¡tica â€” usar `<Link>`',
                ],
                agentScores: [
                    { id: 'frontend-agent',   score: 1.8, reason: 'Especializado en React/Next.js' },
                    { id: 'typescript-agent', score: 1.4, reason: 'Aplica para tipado de props y API routes' },
                    { id: 'backend-agent',    score: 0.5, reason: 'Solo para Route Handlers / Server Actions' },
                ],
                extraNotes: [],
            };
        }

        // â”€â”€ React / Vite SPA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (isReact || isVite) {
            return {
                type: 'frontend',
                runtime: 'Node.js 20 LTS (build) / Browser',
                stack: [
                    isTS ? 'TypeScript' : 'JavaScript',
                    'React 18',
                    isVite ? 'Vite' : 'CRA / webpack',
                ],
                buildTool: isVite ? 'Vite' : 'npm scripts',
                testFramework: testFw,
                structure: `src/
  components/
    ui/           â€” Ã¡tomos y molÃ©culas (Button, Input, Modal)
    features/     â€” componentes con lÃ³gica de dominio
  hooks/          â€” custom hooks
  pages/          â€” vistas / rutas
  store/          â€” estado global (Zustand, Redux, etc.)
  services/       â€” llamadas a API`,
                conventions: [
                    'Componentes funcionales con hooks â€” nunca class components en cÃ³digo nuevo',
                    'Props tipadas con `interface` â€” no `PropTypes` ni `any`',
                    'Custom hooks para lÃ³gica reutilizable â€” no duplicar lÃ³gica entre componentes',
                    'Estado local en componente, estado compartido en store â€” no Context para todo',
                    'Estilos con CSS Modules o Tailwind â€” no estilos inline salvo valores calculados',
                ],
                antiPatterns: [
                    'NO `useEffect` con dependencias vacÃ­as para efectos secundarios en mount â€” preferir inicializaciÃ³n fuera del componente',
                    'NO `any` como tipo de prop â€” definir interface aunque sea bÃ¡sica',
                    'NO mutar el estado directamente â€” siempre crear nuevo objeto/array',
                    'NO lÃ³gica de negocio dentro de JSX â€” extraer a funciones o hooks',
                ],
                agentScores: [
                    { id: 'frontend-agent',   score: 1.8, reason: 'Especializado en React y frontend' },
                    { id: 'typescript-agent', score: 1.4, reason: 'Aplica para tipado de componentes' },
                    { id: 'backend-agent',    score: 0.3, reason: 'No aplica â€” proyecto frontend puro' },
                ],
                extraNotes: [],
            };
        }

        // â”€â”€ Node.js genÃ©rico (CLI, scripts, backend sin framework) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        return {
            type: 'node',
            runtime: 'Node.js 20 LTS',
            stack: [isTS ? 'TypeScript' : 'JavaScript', isExpress ? 'Express' : 'Node.js puro'],
            buildTool: 'npm scripts' + (isTS ? ' + tsc' : ''),
            testFramework: testFw,
            structure: `src/
  index.ts / app.ts
  routes/       â€” si tiene HTTP
  services/     â€” lÃ³gica de negocio
  utils/        â€” utilidades sin estado
tests/`,
            conventions: [
                'Async/await para toda I/O â€” nunca callbacks crudos ni `.then()` encadenado',
                'Sin `any` explÃ­cito â€” usar tipos o `unknown` con narrowing',
                'Errores como valores â€” funciones retornan `{ data, error }` o Result type',
                'Escritura de archivos con operaciÃ³n atÃ³mica (tmp + rename) para evitar corrupciÃ³n',
            ],
            antiPatterns: [
                'NO `require()` sincrÃ³nico dentro de funciones async â€” usar `import()` dinÃ¡mico',
                'NO `process.exit()` en cÃ³digo de librerÃ­a â€” solo en punto de entrada',
                'NO hardcodear rutas absolutas â€” usar `path.join`, `process.cwd()`, `os.homedir()`',
            ],
            agentScores: [
                { id: 'backend-agent',    score: 1.6, reason: 'Aplica para backends Node.js' },
                { id: 'typescript-agent', score: isTS ? 1.4 : 0.5, reason: isTS ? 'Aplica para tipado TS' : 'Poco aplica â€” proyecto JS' },
            ],
            extraNotes: isTS
                ? ['`tsc --noEmit` debe pasar limpio antes de cada commit']
                : ['Considerar migrar a TypeScript para mejor autocompletado y seguridad de tipos'],
        };
    }

    // â”€â”€ GenÃ©rico (sin archivos de proyecto reconocibles) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return {
        type: 'generic',
        runtime: 'indicar runtime y versiÃ³n',
        stack: ['indicar lenguaje y framework principal'],
        buildTool: 'indicar herramienta de build',
        testFramework: 'indicar framework de tests',
        structure: `src/           â€” cÃ³digo fuente
tests/         â€” tests
(completar con la estructura real del proyecto)`,
        conventions: [
            'Agregar las convenciones del equipo (naming, estructura, patrones preferidos)',
            'Indicar el estilo de manejo de errores del proyecto',
            'Describir cÃ³mo se organizan los tests',
        ],
        antiPatterns: [
            'Listar lo que explÃ­citamente NO querÃ©s que el agente haga en este proyecto',
            'Ejemplos: no usar librerÃ­a X, no generar cÃ³digo con patrÃ³n Y',
        ],
        agentScores: [
            { id: 'general', score: 1.0, reason: 'Agente por defecto hasta que se configure routing especÃ­fico' },
        ],
        extraNotes: [
            'ReemplazÃ¡ todas las secciones con la informaciÃ³n real del proyecto',
        ],
    };
}

// â”€â”€ Templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildAgentMdTemplate(projectName: string, s: ProjectSignals): string {
    const stackLine        = s.stack.join(', ');
    const conventionLines  = s.conventions.map(c  => `- ${c}`).join('\n');
    const antiPatternLines = s.antiPatterns.map(a  => `- ${a}`).join('\n');
    const structureLines   = s.structure;
    const extraNotesBlock  = s.extraNotes.length
        ? '\n> **Pendiente de completar:**\n' + s.extraNotes.map(n => `> - ${n}`).join('\n') + '\n'
        : '';

    const agentScoreLines = s.agentScores
        .map(a => `\n## @${a.id} â€” score: ${a.score}\n${a.reason}`)
        .join('\n');

    return `# AGENT.md â€” ${projectName}

> Instrucciones para DeepSeek Code en este proyecto.
> LeÃ­do al arrancar: su contenido se inyecta en el system prompt del agente.
> EditÃ¡ los valores que no correspondan a la realidad del proyecto.
${extraNotesBlock}
---

## Stack y tecnologÃ­as

- **Runtime:** ${s.runtime}
- **Stack:** ${stackLine}
- **Build:** ${s.buildTool}
- **Testing:** ${s.testFramework}

## Estructura del proyecto

\`\`\`
${structureLines}
\`\`\`

## Agentes y pesos iniciales de routing

> Formato: \`## @<agent-id> â€” score: <N.N>\`
> Rango vÃ¡lido: [0.1, 3.0]. Se aplica solo si no hay historial previo para ese agente.
> Score bajo (< 0.5) = agente irrelevante para este proyecto.
${agentScoreLines}

## Convenciones de cÃ³digo

${conventionLines}

## Anti-patrones conocidos

${antiPatternLines}

## Policy Overrides (opcional)

> Reglas de polÃ­tica especÃ­ficas del proyecto en formato YAML.
> Se mergean con el manifest global (~/\.bk-agent/manifest.yaml).
> ValidaciÃ³n: \`rewardFactor\` debe estar en [0.5, 2.0].

\`\`\`yaml
# Ejemplo â€” descomentar y adaptar al proyecto:
# - id: no-hardcoded-secrets
#   domain: audit
#   condition: "content.includes('password') || content.includes('api_key')"
#   action: block
#   rewardFactor: 0.5
\`\`\`

---

<!-- Las secciones "## Lessons Learned" son generadas automÃ¡ticamente
     por el ReflectionEngine al detectar patrones de fallo recurrentes.
     No editar manualmente â€” se actualizan con escritura atÃ³mica. -->
`;
}

function buildUserMdTemplate(): string {
    return `# USER.md â€” Preferencias del Desarrollador

> Tus preferencias personales para DeepSeek Code.
> Este archivo aplica a TODOS tus proyectos â€” vive en ~/\.bk-agent/USER.md.
> EditÃ¡ los valores de ejemplo con tus preferencias reales.

---

## Perfil

> La lÃ­nea "role:" define tu perfil de desarrollador para el routing de agentes.
> Valores comunes: backend senior | backend junior | frontend senior | frontend junior
>                  full stack | tech lead | data engineer | devops | mobile developer

role: backend senior

---

## Estilo de comunicaciÃ³n

- Respuestas directas al punto â€” sin preÃ¡mbulo ni resumen al final
- Asumir conocimiento de TypeScript, Node.js, Git y terminal
- Mostrar el cÃ³digo antes que la explicaciÃ³n
- Cuando algo falla, mostrar el error exacto y la causa raÃ­z â€” no solo "revisÃ¡ el cÃ³digo"
- Si hay mÃ¡s de una forma vÃ¡lida, mostrar mÃ¡ximo 2 opciones con el tradeoff concreto

---

## Preferencias de cÃ³digo

- Async/await sobre Promises encadenadas o callbacks
- Tipos explÃ­citos en firmas de funciones pÃºblicas; inferencia para variables locales
- Funciones pequeÃ±as con un propÃ³sito claro â€” si hace mÃ¡s de una cosa, sugerir dividir
- Sin abstracciones prematuras â€” no crear helpers para cÃ³digo que aparece menos de 3 veces
- Sin comentarios que expliquen quÃ© hace el cÃ³digo â€” solo comentar el por quÃ© no obvio

---

## Frameworks y herramientas preferidas

- **Backend:** Node.js + TypeScript (NestJS para proyectos grandes, Express para scripts)
- **Frontend:** React + Vite o Next.js segÃºn el caso
- **Testing:** Jest + ts-jest
- **No usar:** lodash (preferir stdlib), moment (preferir date-fns o Intl nativo)
- **Base de datos preferida:** PostgreSQL con Prisma o TypeORM

---

## Flujo de trabajo

- Commits atÃ³micos con convenciÃ³n: \`feat/fix/chore/refactor(scope): mensaje en imperativo\`
- Antes de una refactorizaciÃ³n grande, confirmar el enfoque primero â€” no asumir aprobaciÃ³n
- No crear archivos de documentaciÃ³n ni README salvo pedido explÃ­cito
- No modificar archivos fuera del scope pedido, aunque "se vea mejorable"

---

## Lo que NO quiero

- Emojis en el cÃ³digo o en archivos que no los tenÃ­an antes
- ResÃºmenes de lo que acabÃ¡s de hacer â€” puedo leer el diff
- Error handling para escenarios que no pueden ocurrir en la prÃ¡ctica
- Feature flags ni shims de retrocompatibilidad cuando se puede cambiar el cÃ³digo directo
- Sugerencias de "mientras estoy, tambiÃ©n refactorizo X" â€” hacer solo lo pedido
`;
}

// â”€â”€ Entrada pÃºblica â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * @description InicializaciÃ³n idempotente al arrancar la CLI.
 * Crea directorios y archivos solo si no existen â€” nunca sobreescribe.
 *
 * @param cwd Directorio del proyecto (default: process.cwd())
 * @returns DescripciÃ³n de lo que fue creado en esta ejecuciÃ³n
 */
export async function runGlobalSeed(cwd: string = process.cwd()): Promise<SeedResult> {
    const home       = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    const globalDir  = path.join(home, '.bk-agent');
    const projectKey = cwdToProjectKey(cwd);
    const projectDir = path.join(globalDir, 'projects', projectKey);
    const projectName = path.basename(cwd);

    const result: SeedResult = {
        createdUserMd:  false,
        createdAgentMd: false,
        createdDirs:    [],
    };

    // â”€â”€ 1. Directorios globales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const dirsToCreate = [
        globalDir,
        getGlobalAgentsDir(),
        getGlobalSkillsDir(),
        path.join(globalDir, 'projects'),
        projectDir,
    ];

    await Promise.all(dirsToCreate.map(async (dir) => {
        try {
            await fs.mkdir(dir, { recursive: true });
            result.createdDirs.push(dir);
        } catch { /* ya existe */ }
    }));

    // â”€â”€ 2. USER.md global (~/\.bk-agent/USER.md) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Sembrar skills builtin en ~/.bk-agent/skills/ (solo si no existen — el usuario puede editarlos)
    const skillsDir = getGlobalSkillsDir();
    await Promise.all(BUILTIN_SKILLS.map(async (skill) => {
        const skillPath = path.join(skillsDir, `${skill.name}.yaml`);
        if (!(await fileExists(skillPath))) {
            await fs.writeFile(skillPath, yaml.stringify(skill), 'utf-8');
        }
    }));

    const userMdPath = path.join(globalDir, 'USER.md');
    if (!(await fileExists(userMdPath))) {
        await fs.writeFile(userMdPath, buildUserMdTemplate(), 'utf-8');
        result.createdUserMd = true;
    }

    // â”€â”€ 3. AGENT.md en la raÃ­z del proyecto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const agentMdPath = path.join(cwd, 'AGENT.md');
    if (!(await fileExists(agentMdPath))) {
        const signals = await detectProjectType(cwd);
        await fs.writeFile(agentMdPath, buildAgentMdTemplate(projectName, signals), 'utf-8');
        result.createdAgentMd = true;
    }

    return result;
}

