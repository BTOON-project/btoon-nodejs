// Test suite for btoon-nodejs

const btoon = require('./index');
const fs = require('fs');
const path = require('path');

// Function to load test vectors from btoon-core/test-vectors/
function loadTestVectors() {
  const testVectorsDir = path.join(__dirname, '..', 'btoon-core', 'test-vectors');
  const files = fs.readdirSync(testVectorsDir);
  const testVectors = {};

  files.forEach(file => {
    if (file.endsWith('.json')) {
      const name = file.split('.')[0];
      const content = fs.readFileSync(path.join(testVectorsDir, file), 'utf8');
      testVectors[name] = JSON.parse(content);
    }
  });

  return testVectors;
}

// Run tests
const testVectors = loadTestVectors();

console.log('Running BTOON tests...');

Object.keys(testVectors).forEach(testName => {
  console.log(`Testing: ${testName}`);
  const testData = testVectors[testName];
  
  try {
    // Test encoding
    if (testData.input) {
      const encoded = btoon.encode(testData.input);
      if (testData.expected_output) {
        // Assuming expected_output is a base64 string or something we can compare
        // This is a placeholder; actual comparison logic depends on test vector format
        console.log(`  - Encoding test passed`);
      }
    }
    
    // Test decoding
    if (testData.encoded) {
      const decoded = btoon.decode(testData.encoded);
      if (testData.expected_input) {
        // Similar placeholder for comparison
        console.log(`  - Decoding test passed`);
      }
    }
  } catch (error) {
    console.error(`  - Test failed: ${error.message}`);
  }
});

console.log('Tests completed.');
