# Convenience targets; each wraps an npm script in package.json.
NPM := npm

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Available targets:"
	@echo "  install - Install dependencies from the lockfile"
	@echo "  dev     - Start the development server"
	@echo "  check   - Type-check, lint, check formatting and run the tests"
	@echo "  build   - Build the self-contained game into dist/"
	@echo "  preview - Serve the production build locally"
	@echo "  clean   - Remove build output"

.PHONY: install
install:
	$(NPM) ci

.PHONY: dev
dev:
	$(NPM) run dev

.PHONY: check
check:
	$(NPM) run check

.PHONY: build
build:
	$(NPM) run build

.PHONY: preview
preview: build
	$(NPM) run preview

.PHONY: clean
clean:
	rm -rf dist
