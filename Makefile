.PHONY: build test examples prebuild clean

build:
	npm install --ignore-scripts && npx node-gyp rebuild

test: build
	npm test

examples: build
	npm run examples

# Run from a local (non-network) disk: node_modules/.bin symlinks don't work on SMB shares.
prebuild:
	npx prebuildify --napi --strip --target 18.0.0

clean:
	rm -rf build prebuilds node_modules
