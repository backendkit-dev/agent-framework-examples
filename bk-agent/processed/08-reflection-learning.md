# 08 - Reflection Engine & Auto-Learning

The Reflection Engine learns from patterns and automatically prevents them.

## How It Works

```
Incident Detected
    ↓
Failure Catalog (recorded)
    ↓
Pattern Detection (>=3 same type)
    ↓
Policy Promotion (becomes automatic rule)
    ↓
Prevention (future operations blocked/warned)
```

## Example Cycle

**Iteration 1:**
```
/spec.run → generates code
❌ Missing error handling detected
→ Recorded: "missing_error_handling"
```

**Iteration 2:**
```
/spec.run → generates different code
❌ Missing error handling again
→ Recorded: 2nd occurrence
```

**Iteration 3:**
```
/spec.run → generates different code
❌ Missing error handling again
→ Pattern detected! (3 occurrences)
→ Policy created: "Always wrap operations in try-catch"
```

**Iteration 4+:**
```
/spec.run
→ System checks policy
→ Code automatically includes error handling
✓ Prevention works!
```

## 5 Domains of Failure

### 1. Audit Domain
Detects:
- LINT_ERROR — Style/format issues
- TYPE_ERROR — TypeScript validation
- LOGIC_ERROR — Business logic problems
- SECURITY_WARNING — Security issues

**Triggered by:** Code review gates

### 2. Test Domain
Detects:
- TEST_FAIL — Test failures
- COVERAGE_LOW — Low coverage
- TIMEOUT — Test timeout
- FLAKY — Intermittent failures

**Triggered by:** Test validation

### 3. Commit Domain
Detects:
- COMMIT_HOOK_FAIL — Pre-commit failure
- MERGE_CONFLICT — Merge issues
- MESSAGE_FORMAT — Commit message errors

**Triggered by:** Git operations

### 4. Agent Domain
Detects:
- TOOL_FAIL — Tool execution error
- DELEGATION_FAIL — Sub-agent failure
- ROUTING_ERROR — Agent selection issue

**Triggered by:** Tool execution

### 5. Bootstrap Domain
Detects:
- CONFIG_ERROR — Configuration issue
- SETUP_FAIL — Initial setup problem
- DEPENDENCY_ERROR — Missing dependency

**Triggered by:** Project initialization

## Monitoring Reflection

### View Statistics

```bash
/status
```

Shows:
- Total failures recorded
- Patterns detected
- Policies promoted
- Prevention rules active

### View Lessons Learned

```bash
/memory
```

Shows project's lessons and patterns.

## Prevention Rules

Once a pattern is detected, the system creates rules.

### Automatic Prevention

System blocks operations that violate rules:

```
User: "generate a function without error handling"

System checks:
→ Pattern: "missing_error_handling" detected 3+ times
→ Prevention rule active: "Always add error handling"

Result:
❌ Code rejected
→ "This code violates prevention rule: missing_error_handling"
→ Required: Add try-catch or Result<T> handling
```

### Optional Prevention

Some rules warn but allow:

```
User: "generate code without logging"

System:
⚠️ Pattern: "missing_logging" (medium severity)
→ Would recommend: Add BkLogger
→ Proceed? (y/n)
```

## Adjusting Learning

### View All Patterns

```bash
/memory
```

Shows all detected patterns and their frequency.

### Reset Pattern (if needed)

While patterns are stored, you can:

```bash
# Start fresh on next project
/workspace create new-project
```

Each project has independent learning.

### Force Prevention Rule

Manually activate prevention:

```bash
# (From CLI, not yet exposed in /commands)
# Edit ~/.deepseek-code/projects/[project]/reflection.yaml
rules:
  - name: "always_add_auth_checks"
    severity: "critical"
    domains:
      - "agent"
```

## Best Practices

### 1. Let Learning Work

Don't stop reflection — let it detect patterns naturally.

```bash
/spec.run   # Let system learn from results
/spec.qa    # QA findings feed into learning
```

### 2. Monitor Progress

Check what's been learned:

```bash
/status     # See prevention rules active
/memory     # See lessons + patterns
```

### 3. Use for Team Standards

Patterns become team standards over time:

```
Team Pattern: "All async functions must have Result<T>"
After 3+ detections → Prevention rule
New team members: Code automatically follows pattern
```

### 4. Review Lessons Regularly

```bash
/memory
# Read "Lessons Learned" section
# Share with team
```

## Limitations & Gotchas

### Patterns Take Time

Need 3+ similar errors to trigger pattern detection.

### Prevention is Heuristic-Based

Not 100% accurate — some false positives/negatives possible.

### Per-Project Learning

Each project learns independently. Moving projects doesn't transfer learning.

---

**Next Steps:**
- → [09-memory-persistence.md](09-memory-persistence.md) — What gets remembered
- → [04-spec-driven-development.md](04-spec-driven-development.md) — See learning in action
