# ============================================================================
# my-terminal-cli — Makefile
# Git Flow: master → develop → feature/fix/release
# Compatible with: Windows (PowerShell) and Linux
# ============================================================================

SHELL := pwsh.exe
ifeq ($(OS),Windows_NT)
    SHELL := pwsh.exe
else
    SHELL := pwsh
endif

# ── Colors ──
RESET   := \033[0m
CYAN    := \033[36m
GREEN   := \033[32m
YELLOW  := \033[33m
MAGENTA := \033[35m
RED     := \033[31m

.PHONY: help commit feature fix release finish-feature finish-release test typecheck init status log diff

help:
	@echo ""
	@echo "$(MAGENTA)============================================================================"
	@echo "$(MAGENTA) my-terminal-cli — Git Flow Workflow                     "
	@echo "$(MAGENTA)============================================================================"
	@echo ""
	@echo "$(CYAN)Usage:$(RESET)"
	@echo "  make $(GREEN)commit$(RESET) type=feat scope=cli msg=\"add prompt\" dev=mc"
	@echo "  make $(GREEN)feature$(RESET) type=feat scope=cli msg=\"add prompt\" dev=mc"
	@echo "  make $(GREEN)fix$(RESET) type=fix scope=prompt msg=\"fix input lag\" dev=mc"
	@echo "  make $(GREEN)release$(RESET) type=feat scope=cli msg=\"bump v1.1.0\" version=1.1.0"
	@echo "  make $(GREEN)finish-feature$(RESET) dev=mc"
	@echo "  make $(GREEN)finish-release$(RESET) version=1.1.0"
	@echo "  make $(GREEN)init$(RESET)"
	@echo "  make $(GREEN)status$(RESET)"
	@echo "  make $(GREEN)log$(RESET)"
	@echo ""
	@echo "$(YELLOW)Parameters:$(RESET)"
	@echo "  type      Commit type: feat|fix|refactor|test|docs|chore|style|perf|ci|build|revert"
	@echo "  scope     Scope: cli|components|prompt|theme|messages|config|deps|infra|docs"
	@echo "  msg       Short imperative description (e.g., \"add interactive prompt\")"
	@echo "  body      Optional detailed description (use quotes)"
	@echo "  dev       Developer initials (e.g., mc for mairon.cuello)"
	@echo "  version   Version number for releases (e.g., 1.1.0)"
	@echo "  breaking  Set to 1 for breaking change"
	@echo ""
	@echo "$(CYAN)Examples:$(RESET)"
	@echo "  # Start a new feature"
	@echo "  make commit type=feat scope=cli msg=\"add interactive prompt\" dev=mc"
	@echo ""
	@echo "  # Fix a bug"
	@echo "  make fix type=fix scope=prompt msg=\"fix input lag\" dev=mc"
	@echo ""
	@echo "  # Finish feature (merge to develop)"
	@echo "  make finish-feature dev=mc"
	@echo ""
	@echo "  # Create release branch"
	@echo "  make release type=feat scope=cli msg=\"bump to v1.1.0\" version=1.1.0"
	@echo ""
	@echo "  # Finish release (merge to master + tag)"
	@echo "  make finish-release version=1.1.0"
	@echo ""

# ── Commit (auto-creates feature/fix branch) ──
commit:
	@echo "$(CYAN)� Running commit workflow...$(RESET)"
	@$(SHELL) -NoProfile -Command "& '.\scripts\commit-workflow.ps1' -Type '$(type)' -Scope '$(scope)' -Message '$(msg)' $(if $(body),-Body '$(body)',) $(if $(breaking),-BreakingChange,) -DeveloperInitials '$(dev)'"

# ── Feature (explicit feature branch) ──
feature:
	@echo "$(CYAN)� Starting new feature...$(RESET)"
	@$(SHELL) -NoProfile -Command "& '.\scripts\commit-workflow.ps1' -Type '$(type)' -Scope '$(scope)' -Message '$(msg)' $(if $(body),-Body '$(body)',) $(if $(breaking),-BreakingChange,) -BranchType feature -DeveloperInitials '$(dev)'"

# ── Fix (explicit fix branch) ──
fix:
	@echo "$(CYAN)� Starting bug fix...$(RESET)"
	@$(SHELL) -NoProfile -Command "& '.\scripts\commit-workflow.ps1' -Type '$(type)' -Scope '$(scope)' -Message '$(msg)' $(if $(body),-Body '$(body)',) $(if $(breaking),-BreakingChange,) -BranchType fix -DeveloperInitials '$(dev)'"

# ── Release branch ──
release:
	@echo "$(CYAN)� Creating release branch...$(RESET)"
	@$(SHELL) -NoProfile -Command "& '.\scripts\commit-workflow.ps1' -Type '$(type)' -Scope '$(scope)' -Message '$(msg)' $(if $(body),-Body '$(body)',) -BranchType release -Version '$(version)'"

# ── Finish feature (merge to develop) ──
finish-feature:
	@echo "$(CYAN)� Finishing feature...$(RESET)"
	@$(SHELL) -NoProfile -Command "& '.\scripts\commit-workflow.ps1' -FinishFeature -DeveloperInitials '$(dev)'"

# ── Finish release (merge to master + tag) ──
finish-release:
	@echo "$(CYAN)� Finishing release...$(RESET)"
	@$(SHELL) -NoProfile -Command "& '.\scripts\commit-workflow.ps1' -FinishRelease -Version '$(version)'"

# ── Run tests ──
test:
	@echo "$(CYAN)� Running test suite...$(RESET)"
	@npx jest

test-watch:
	@echo "$(CYAN)� Running tests in watch mode...$(RESET)"
	@npx jest --watch

test-coverage:
	@echo "$(CYAN)� Running tests with coverage...$(RESET)"
	@npx jest --coverage

# ── TypeScript check ──
typecheck:
	@echo "$(CYAN)� Running TypeScript type check...$(RESET)"
	@npx tsc --noEmit

# ── Initialize git with Git Flow structure ──
init:
	@echo "$(CYAN)� Initializing git repository with Git Flow...$(RESET)"
	@git init
	@git checkout -b develop
	@echo "$(GREEN) Git repository initialized.$(RESET)"
	@echo "� Branches: master (created), develop (active)"
	@echo "� Don't forget to create a .gitignore file."

status:
	@echo "$(CYAN)� Git status:$(RESET)"
	@git status

log:
	@echo "$(CYAN)� Git log (graph):$(RESET)"
	@git log --oneline --decorate --graph -20

diff:
	@echo "$(CYAN)� Working tree diff:$(RESET)"
	@git diff

diff-staged:
	@echo "$(CYAN)� Staged diff:$(RESET)"
	@git diff --cached
