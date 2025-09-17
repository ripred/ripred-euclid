# Variables
NPM := npm
DIST_DIR := dist
DEVVIT_DIR := .devvit

# Default target shows help
.DEFAULT_GOAL := help

# Help target
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  clean   - Remove dist and .devvit directories"
	@echo "  install - Install npm dependencies"
	@echo "  build   - Clean and build the project"
	@echo "  build-complete - Build with verification checks"
	@echo "  dev     - Build and start development server"
	@echo "  check   - Run type-check, lint, and prettier"
	@echo "  deploy  - Build and deploy to Devvit"
	@echo "  launch  - Full build, deploy, and publish"
	@echo "  help    - Show this help message"

# Clean build artifacts
.PHONY: clean
clean:
	rm -rf $(DIST_DIR) $(DEVVIT_DIR)

# Install dependencies
.PHONY: install
install:
	$(NPM) install

# Build the project
.PHONY: build
build: clean
	$(NPM) run build

# Build with verification
.PHONY: build-complete
build-complete: build
	@echo "Verifying build artifacts..."
	@test -f $(DIST_DIR)/server/index.cjs || (echo "Error: server build not found" && exit 1)
	@test -s $(DIST_DIR)/server/index.cjs || (echo "Error: server build is empty" && exit 1)
	@echo "Build verification complete"

# Development server (requires existing build)
.PHONY: dev
dev: build-complete
	$(NPM) run dev

# Code quality checks
.PHONY: check
check:
	$(NPM) run check

# Deploy to devvit
.PHONY: deploy
deploy: build-complete
	$(NPM) run deploy

# Full launch (build + deploy + publish)
.PHONY: launch
launch:
	$(NPM) run launch