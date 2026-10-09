# 10 - BackendKit Labs Integration

bk-agent includes native support for **BackendKit Labs** libraries, automating best practices for backend development.

## Overview

BackendKit provides production-grade libraries for resilience, error handling, observability, and type safety.

## @backendkit-labs/result

**Typed Error Handling** — Never throw, return Result<T, E>

### Installation
```bash
npm install @backendkit-labs/result
```

### Usage

```typescript
import { ok, err, Result } from '@backendkit-labs/result';

// Return success
function getUser(id: string): Result<User, 'NOT_FOUND'> {
  const user = database.findUser(id);
  return user ? ok(user) : err('NOT_FOUND');
}

// Handle result
const result = getUser('123');
if (result.isOk()) {
  console.log(result.value);
} else {
  console.error(result.error);
}

// Chain operations
getUser('123')
  .andThen(user => validateUser(user))
  .map(user => user.email)
  .orElse(error => "User not found")
```

### Error Types

Define as union literals:

```typescript
type UserErrors = 'NOT_FOUND' | 'INVALID_EMAIL' | 'CONFLICT';

function createUser(email: string): Result<User, UserErrors> {
  if (!isValidEmail(email)) {
    return err('INVALID_EMAIL');
  }
  if (userExists(email)) {
    return err('CONFLICT');
  }
  const user = new User(email);
  return ok(user);
}
```

### When to Use

✓ Domain errors (validation, business logic)
✓ Recoverable errors
✓ Expected failure scenarios

✗ Programming errors (should throw)
✗ Unexpected system failures

---

## @backendkit-labs/circuit-breaker

**Resilience Pattern** — Prevent cascading failures

### Installation
```bash
npm install @backendkit-labs/circuit-breaker
```

### Usage

```typescript
import { CircuitBreaker } from '@backendkit-labs/circuit-breaker';

const breaker = new CircuitBreaker({
  failureThreshold: 5,        // Failures before open
  resetTimeout: 60000,        // ms before half-open
  monitoringInterval: 10000,  // Check interval
});

async function callExternalAPI() {
  return breaker.execute(async () => {
    return httpClient.get('https://api.external.com/data');
  });
}
```

### Error Classification

**Business Errors** (don't open circuit):
- HTTP 400, 404 (client errors)
- HTTP 401, 403 (auth errors)

**Infrastructure Errors** (open circuit):
- HTTP 500, 502, 503 (server errors)
- Timeouts
- Network errors

```typescript
const breaker = new CircuitBreaker({
  classifyError: (error: Error) => {
    if (error.statusCode === 429) {
      return 'business';  // Rate limited, but recoverable
    }
    if (error.statusCode >= 500) {
      return 'infrastructure';
    }
    return 'business';
  }
});
```

### States

| State | Behavior |
|-------|----------|
| **CLOSED** | Requests pass through normally |
| **OPEN** | Requests rejected immediately (fail fast) |
| **HALF_OPEN** | Limited requests to test recovery |

---

## @backendkit-labs/bulkhead

**Concurrency Control** — Limit concurrent requests

### Installation
```bash
npm install @backendkit-labs/bulkhead
```

### Usage

```typescript
import { Bulkhead } from '@backendkit-labs/bulkhead';
import { CircuitBreaker } from '@backendkit-labs/circuit-breaker';

const bulkhead = new Bulkhead({ maxConcurrent: 10 });
const breaker = new CircuitBreaker();

// Correct order: Bulkhead → Circuit Breaker → Operation
async function safeExternalCall() {
  return bulkhead.execute(async () => {
    return breaker.execute(async () => {
      return httpClient.get('/external-api');
    });
  });
}
```

### Configuration

```typescript
const bulkhead = new Bulkhead({
  maxConcurrent: 10,           // Max parallel requests
  queueSize: 50,               // Waiting queue size
  rejectWhenQueueFull: true,   // Reject or queue?
});
```

---

## @backendkit-labs/http-client

**Production HTTP Client** — Result + Circuit Breaker + Retry

### Installation
```bash
npm install @backendkit-labs/http-client
```

### Usage

```typescript
import { HttpClient } from '@backendkit-labs/http-client';

const client = new HttpClient({
  baseUrl: 'https://api.example.com',
  timeout: 5000,
  retryAttempts: 3,
  retryDelay: 1000,
});

// Returns Result<T, Error>
const result = await client.get('/users/123');

if (result.isOk()) {
  console.log(result.value);
} else {
  console.error('Failed:', result.error.message);
}
```

### Features

- ✓ Built-in error handling (Result<T, E>)
- ✓ Circuit breaker
- ✓ Retry with exponential backoff
- ✓ Request cancellation
- ✓ Request/response interceptors

---

## @backendkit-labs/observability

**Structured Logging & Metrics** — For NestJS

### Installation
```bash
npm install @backendkit-labs/observability
```

### Setup in AppModule

```typescript
import { ObservabilityModule } from '@backendkit-labs/observability';
import { CorrelationIdInterceptor, BkExceptionFilter } from '@backendkit-labs/observability';

@Module({
  imports: [
    // Must be first import!
    ObservabilityModule.forRoot({
      logLevel: 'debug',
      enableMetrics: true,
    }),
    // ... other modules
  ],
})
export class AppModule {}
```

### Setup in main.ts

```typescript
import { BkLogger } from '@backendkit-labs/observability';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Add interceptor (for request tracing)
  app.useGlobalInterceptors(
    new CorrelationIdInterceptor()
  );

  // Add exception filter
  app.useGlobalFilters(
    new BkExceptionFilter(new BkLogger())
  );

  await app.listen(3000);
}
```

### Usage

```typescript
import { BkLogger } from '@backendkit-labs/observability';

@Injectable()
export class UsersService {
  constructor(private logger: BkLogger) {}

  async getUser(id: string) {
    this.logger.log(`Fetching user ${id}`);
    const user = await this.database.findUser(id);
    this.logger.debug(`User found: ${user.id}`);
    return user;
  }
}
```

### Logging Levels

```typescript
logger.debug('Detailed info');    // Dev
logger.log('Normal info');        // Prod
logger.warn('Warning');           // Important
logger.error('Error occurred');   // Critical
logger.fatal('Fatal error');      // System down
```

---

## @backendkit-labs/pipeline

**Async Pipeline** — Type-safe sequential/parallel operations

### Installation
```bash
npm install @backendkit-labs/pipeline
```

### Usage

```typescript
import { pipe } from '@backendkit-labs/pipeline';

// Sequential with error handling
const result = await pipe([
  () => validateInput(),
  (input) => processInput(input),
  (processed) => saveToDatabase(processed),
])
  .withMode('stop-on-first')  // Stop at first error
  .execute();

// Parallel, collect all results
const results = await pipe([
  () => fetchUser('123'),
  () => fetchOrders('123'),
  () => fetchSettings('123'),
])
  .withMode('collect-all')  // Run all, collect errors
  .execute();
```

### Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **stop-on-first** | Stop at first error | Critical operations |
| **collect-all** | Run all, collect errors | Independent tasks |

---

## @backendkit-labs/request-scanner

**Security Scanning** — Detect attacks in HTTP requests

### Installation

Requires `.npmrc` with GitHub Packages:

```
@backendkit-labs:registry=https://npm.pkg.github.com
```

```bash
npm install @backendkit-labs/request-scanner
```

### Usage in NestJS

```typescript
import { RequestScannerModule } from '@backendkit-labs/request-scanner';

@Module({
  imports: [
    RequestScannerModule.forRoot({
      blockSuspicious: true,
      logLevel: 'warn',
    }),
    // ... other modules
  ],
})
export class AppModule {}
```

### What It Detects

- SQL injection attempts
- XSS payloads
- Path traversal
- Command injection
- Malformed data

---

## Best Practices with bk-agent

### 1. Always Use Result<T, E>

When generating code, bk-agent uses Result by default:

```typescript
// bk-agent generates this:
async createUser(email: string): Promise<Result<User, 'INVALID_EMAIL' | 'CONFLICT'>> {
  // ...
}

// Not this (avoided):
async createUser(email: string): Promise<User> {
  // throws errors
}
```

### 2. Add Observability from Start

bk-agent injects observability automatically:

```
/spec.run
→ Generates code with BkLogger
→ Includes CorrelationIdInterceptor
→ Adds BkExceptionFilter
```

### 3. Resilience by Default

When generating external API calls:

```typescript
// bk-agent generates
const client = new HttpClient({
  retryAttempts: 3,
  timeout: 5000,
});

const result = await client.get('/external');
// Returns Result<T, E>
```

### 4. Pipeline for Sequential Operations

```typescript
// For step-by-step operations
const result = await pipe([
  () => validateRequest(),
  (valid) => processData(valid),
  (processed) => saveToDatabase(processed),
])
  .withMode('stop-on-first')
  .execute();
```

---

## Examples

### Complete Service with BackendKit

```typescript
import { Result, ok, err } from '@backendkit-labs/result';
import { HttpClient } from '@backendkit-labs/http-client';
import { BkLogger } from '@backendkit-labs/observability';
import { Bulkhead } from '@backendkit-labs/bulkhead';
import { CircuitBreaker } from '@backendkit-labs/circuit-breaker';

@Injectable()
export class PaymentService {
  private httpClient = new HttpClient();
  private breaker = new CircuitBreaker();
  private bulkhead = new Bulkhead({ maxConcurrent: 10 });

  constructor(private logger: BkLogger) {}

  async processPayment(amount: number): Promise<Result<Payment, 'INVALID_AMOUNT' | 'API_ERROR'>> {
    if (amount <= 0) {
      return err('INVALID_AMOUNT');
    }

    this.logger.log(`Processing payment: $${amount}`);

    const result = await this.bulkhead.execute(async () => {
      return this.breaker.execute(async () => {
        return this.httpClient.post('/payments', { amount });
      });
    });

    if (result.isOk()) {
      this.logger.log(`Payment successful: ${result.value.id}`);
      return ok(result.value);
    } else {
      this.logger.error(`Payment failed: ${result.error}`);
      return err('API_ERROR');
    }
  }
}
```

---

**Next Steps:**
- → [02-installation-setup.md](02-installation-setup.md) — Start with bk-agent
- → [04-spec-driven-development.md](04-spec-driven-development.md) — Generate BackendKit code
- → [06-skills-system.md](06-skills-system.md) — Create BackendKit skills
