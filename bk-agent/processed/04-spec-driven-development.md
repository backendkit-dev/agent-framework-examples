# 04 - Spec-Driven Development Complete Guide

The `/spec` workflow is the **core development flow** of bk-agent. It automates the entire cycle from requirements to deployment.

## 📊 The 5-Phase Roadmap

```
Phase 1: SPECIFY
├─ Define requirements
├─ Generate specification
├─ Design architecture
└─ Create roadmap

Phase 2: IMPLEMENT (repeat per feature)
├─ Receive task instructions
├─ Generate code
└─ Save progress

Phase 3: VERIFY (QA)
├─ Automated code review
├─ Test validation
└─ Findings documented

Phase 4: INTEGRATE
└─ Merge with main branch

Phase 5: DEPLOY
└─ Deploy to production
```

---

## Phase 1: Specification & Design (SPECIFY)

### Step 1: Capture Requirements

```bash
/spec.prompt "API REST for user management with JWT auth, OAuth2 integration, and role-based access control"
```

**What it does:**
- Creates `prompt.md` with your requirements
- Structures the input for next steps
- Can read from file: `/spec.prompt --file requirements.txt`

**Output file:** `project/prompt.md`

```markdown
# Requirements

API REST for user management with JWT auth, OAuth2 integration, and role-based access control

## Scope
- ...

## Success Criteria
- ...
```

---

### Step 2: Generate Specification

```bash
/spec.specify
```

**What it does:**
1. Reads `prompt.md`
2. Uses reasoning LLM to create detailed spec
3. Generates functional + non-functional requirements
4. Creates acceptance criteria

**Output file:** `project/specification.md` (detailed, ~2000 words)

```markdown
# API REST - User Management System Specification

## 1. Functional Requirements
### 1.1 Authentication
- JWT token generation and validation
- OAuth2 provider integration
- Refresh token mechanism
- ...

## 2. Non-Functional Requirements
### 2.1 Security
- HTTPS only
- Rate limiting
- Input validation
- ...

## 3. API Endpoints
- POST /auth/login
- POST /auth/register
- GET /users/:id
- ...
```

**Revise if needed:**
```bash
/spec.revise.specify "add MFA requirement, add audit logging requirements"
```

---

### Step 3: Generate Design Document

```bash
/spec.plan
```

**What it does:**
1. Reads `specification.md` + `prompt.md`
2. Creates detailed architecture
3. Defines components and flow
4. Specifies technologies and patterns

**Output file:** `project/design.md` (~3000 words)

```markdown
# User Management API - Architecture Design

## System Architecture
[Diagram showing components]

## Components
### 1. Authentication Service
- JWT generation/validation
- OAuth2 integration
- Token refresh logic

### 2. User Service
- CRUD operations
- Permission checks
- Audit logging

## Data Model
[ERD diagram]

## API Design
[Detailed endpoint specs with examples]

## Technology Stack
- Framework: NestJS
- Database: PostgreSQL
- Cache: Redis
- Queue: RabbitMQ
```

**Revise if needed:**
```bash
/spec.revise.plan "use event-driven architecture instead of direct service calls"
```

---

### Step 4: Create Implementation Roadmap

```bash
/spec.init
```

**What it does:**
1. Analyzes specification + design
2. Creates phased roadmap
3. Breaks work into manageable pieces
4. Sets up tracking

**Output file:** `project/roadmap.md`

```markdown
# Implementation Roadmap

## Phase 1: Core Authentication (Week 1)
- [ ] JWT strategy implementation
- [ ] Login/logout endpoints
- [ ] Token refresh
- [ ] Tests

## Phase 2: User CRUD (Week 2)
- [ ] User model and migrations
- [ ] CRUD endpoints
- [ ] Permission checks
- [ ] Tests

## Phase 3: OAuth2 Integration (Week 3)
- [ ] OAuth2 strategy
- [ ] Provider setup
- [ ] Integration tests
- ...

## Phase 4: Advanced Features (Week 4)
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Admin dashboard
- ...

## Phase 5: Production Ready (Week 5)
- [ ] Security review
- [ ] Performance testing
- [ ] Documentation
- [ ] Deployment setup
```

**View roadmap:**
```bash
/spec.show.roadmap         # Show all phases
/spec.show.roadmap 1       # Show phase 1 only
```

---

## Phase 2: Implementation (IMPLEMENT)

### For Each Feature/Phase:

#### Step 1: Get Current Task Instructions

```bash
/spec.next
```

**Output:**
```
═══════════════════════════════════════════════════════════
Current Phase: IMPLEMENT

Phase 1 - Core Authentication (Week 1)

Tasks:
1. JWT strategy implementation
2. Login/logout endpoints
3. Token refresh mechanism
4. Unit and integration tests

Requirements:
- Use @backendkit-labs/result for error handling
- Add observability from the start
- Follow NestJS best practices
- Implement rate limiting on auth endpoints

Next: Run /spec.run to generate code
═══════════════════════════════════════════════════════════
```

#### Step 2: Generate Code

```bash
/spec.run
```

**What it does:**
1. Reads specification + design + current task
2. Routes to Code Generator agent
3. Generates complete, production-ready code
4. Automatically runs QA review
5. Saves output with progress

**Process shown:**
```
┌─ Reading task specification...
├─ Selecting Code Generator agent...
├─ Generating implementation...
│  ├─ src/auth/jwt.strategy.ts ✓
│  ├─ src/auth/auth.controller.ts ✓
│  ├─ src/auth/auth.service.ts ✓
│  ├─ src/auth/auth.module.ts ✓
│  └─ test/auth.spec.ts ✓
├─ Running QA review...
│  ├─ Code quality: PASS
│  ├─ Test coverage: 89%
│  ├─ Type safety: PASS
│  └─ Security: 2 recommendations
└─ Done! Review at /spec.context
```

#### Step 3: Review Output

**Automated QA already reviewed.** If issues found:
```bash
/spec.qa
```

This generates detailed findings in `qa-phase{N}.md`.

#### Step 4: Save Your Progress

```bash
/checkpoint save "phase-1-auth-complete"
```

This creates a snapshot you can restore later.

---

## Phase 3: Verification (VERIFY)

### Run QA Evaluation

```bash
/spec.qa
```

**What QA checks:**
- ✓ Code quality and style
- ✓ Test coverage (target: >80%)
- ✓ Type safety
- ✓ Security patterns
- ✓ Performance
- ✓ BackendKit pattern compliance

**Output:** `project/qa-phase{N}.md`

```markdown
# QA Review - Phase 1

## Code Quality
✓ PASS - Code follows NestJS conventions
✓ PASS - Proper error handling with Result<T>
⚠ WARNING - One complex function (authentication service)

## Test Coverage
✓ PASS - 89% coverage
✓ PASS - All critical paths covered
✓ PASS - Integration tests for OAuth2

## Security
⚠ CRITICAL - Secrets in environment (use @backendkit-labs/secret-manager)
✓ PASS - Rate limiting implemented
✓ PASS - Input validation present

## Recommendations
1. Extract OAuth2 configuration to vault
2. Add encryption for sensitive data
3. Document error codes for API consumers
```

---

### Decide: Pass or Fail

#### If All Good - Advance to Next Phase

```bash
/spec.advance --passed "Phase 1 complete, all QA checks passed"
```

**Result:** Moves to Phase 2, shows new task instructions.

#### If Issues Found - Fix and Retry

```bash
/spec.advance --failed "Missing rate limiting, need to implement before deployment"
```

**Result:** Reverts to IMPLEMENT phase. Next `/spec.next` injects QA findings:

```
═══════════════════════════════════════════════════════════
Current Phase: IMPLEMENT (Retry)

Previous QA Findings Injected:
⚠ CRITICAL - Secrets in environment
✓ Implement rate limiting
✓ Add encryption for sensitive data

Tasks:
1. Fix identified issues
2. Re-run tests
3. Update documentation

Next: Run /spec.run again with fixes
═══════════════════════════════════════════════════════════
```

---

## Phase 4: Integration (INTEGRATE)

Merge with main branch:

```bash
git merge feature-branch -m "feat: phase-1-complete"
git push origin main
```

---

## Phase 5: Deployment (DEPLOY)

Deploy to production:

```bash
# Example: Deploy to Vercel
vercel deploy --prod

# Or Docker:
docker build -t my-api .
docker push registry.example.com/my-api:latest
```

---

## 🚀 Quick Reference: Complete Cycle

### Minimal Example

```bash
# 1. Define requirements
/spec.prompt "Simple todo API with JWT auth"

# 2. Generate spec
/spec.specify

# 3. Generate design
/spec.plan

# 4. Create roadmap
/spec.init

# 5. Implement phase 1
/spec.next
/spec.run

# 6. QA review
/spec.qa

# 7. If good, advance
/spec.advance --passed "Phase 1 done"

# 8. Repeat for phases 2-5
/spec.next
/spec.run
/spec.qa
/spec.advance --passed "Phase 2 done"
# ... etc
```

### Full Autonomous (Expert Users)

```bash
/spec.prompt "requirements"
/spec.specify
/spec.plan
/spec.init
/spec.go    # Executes all phases automatically
```

---

## 📁 Generated Files Structure

After complete /spec cycle:

```
project/
├── prompt.md              # Initial requirements
├── specification.md       # Detailed specification
├── design.md             # Architecture design
├── roadmap.md            # Phase breakdown
├── qa-phase1.md          # Phase 1 QA findings
├── qa-phase2.md          # Phase 2 QA findings
├── qa-phase3.md          # Phase 3 QA findings
├── qa-phase4.md          # Phase 4 QA findings
└── qa-phase5.md          # Phase 5 QA findings
```

---

## 🎯 Tips & Best Practices

### 1. Start with Clear Requirements
```bash
/spec.prompt "Detailed, specific requirements lead to better code"
```

### 2. Review Specification Before Continuing
```bash
/spec.show.specify
# Read carefully, iterate if needed
/spec.revise.specify "add missing requirements"
```

### 3. Save Progress Frequently
```bash
/checkpoint save "after-phase-2-ui"
```

### 4. Don't Skip QA Phase
```bash
/spec.qa    # Always review QA findings before advancing
```

### 5. Use Revisions for Feedback
```bash
/spec.revise.plan "change from REST to GraphQL"
/spec.run     # Regenerates with new architecture
```

### 6. Review Context Anytime
```bash
/spec.context           # See all documents + status
/spec.show.roadmap      # Check remaining work
```

---

## ⚙️ Advanced: Customizing Spec Workflow

### Use Custom Model for Complex Specs

```bash
/models deepseek-reasoner
/spec.plan    # Uses reasoning model for better design
```

### Inject Custom Context

```bash
/context "Using BackendKit Labs patterns throughout"
/spec.run    # Code generator uses this context
```

### Multiple Specs for Monorepo

```bash
/switch workspace-name project-1
/spec.prompt "API service requirements"
/spec.run

/switch workspace-name project-2
/spec.prompt "Admin dashboard requirements"
/spec.run
```

---

**Next Steps:**
- → [05-agents-specialization.md](05-agents-specialization.md) — Understand agent selection
- → [03-commands-slash.md](03-commands-slash.md) — Command reference
- → [10-backendkit-integration.md](10-backendkit-integration.md) — BackendKit patterns used
