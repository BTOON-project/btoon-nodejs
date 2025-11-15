# Makefile for BTOON Node.js library

.PHONY: all build clean test install release publish help

# Default target
all: build

# Build the native module
build:
	@echo "Building BTOON Node.js module..."
	@npm run build

# Build release version
release:
	@echo "Building release version..."
	@npm run build:release

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@npm run clean
	@rm -rf node_modules package-lock.json
	@rm -f btoon-*.tgz

# Install dependencies
install:
	@echo "Installing dependencies..."
	@npm ci || npm install

# Run tests
test: build
	@echo "Running tests..."
	@npm test

# Quick test
test-quick: build
	@echo "Running quick test..."
	@npm run test:quick

# Run examples
examples: build
	@echo "Running examples..."
	@npm run examples

# Build prebuilds for distribution
prebuild: build
	@echo "Building prebuilds..."
	@npm run prebuild

# Create distribution package
pack: release test
	@echo "Creating distribution package..."
	@npm pack
	@echo "Package created: btoon-*.tgz"

# Publish to npm (requires authentication)
publish: release test
	@echo "Publishing to npm..."
	@npm publish

# Development build with watch
dev:
	@echo "Building in development mode..."
	@npm run build:debug

# Check code
lint:
	@echo "Checking code..."
	@npx eslint --version > /dev/null 2>&1 || npm install -D eslint
	@npx eslint *.js examples/*.js test/*.js

# Help target
help:
	@echo "BTOON Node.js Library Makefile"
	@echo ""
	@echo "Available targets:"
	@echo "  make build      - Build the native module"
	@echo "  make release    - Build release version"
	@echo "  make clean      - Clean build artifacts"
	@echo "  make install    - Install dependencies"
	@echo "  make test       - Run all tests"
	@echo "  make test-quick - Run quick test"
	@echo "  make examples   - Run examples"
	@echo "  make prebuild   - Build prebuilds for distribution"
	@echo "  make pack       - Create npm package"
	@echo "  make publish    - Publish to npm"
	@echo "  make dev        - Build debug version"
	@echo "  make lint       - Check code style"
	@echo "  make help       - Show this help"
