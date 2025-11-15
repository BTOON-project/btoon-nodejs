const chai = require('chai');
const expect = chai.expect;
const btoon = require('../index');

describe('BTOON Node.js Binding', () => {
  describe('Encoding', () => {
    it('should encode basic data types correctly', () => {
      const data = {
        string: 'Hello, BTOON!',
        number: 42,
        boolean: true,
        nullValue: null,
        array: [1, 2, 3],
        nested: { a: 1, b: 'test' }
      };
      
      const encoded = btoon.encode(data);
      expect(encoded).to.be.an.instanceof(Buffer);
      expect(encoded.length).to.be.greaterThan(0);
    });

    it('should handle tabular data', () => {
      const tabularData = {
        table: [
          { id: 1, name: 'Alice', age: 25 },
          { id: 2, name: 'Bob', age: 30 },
          { id: 3, name: 'Charlie', age: 35 }
        ]
      };
      const encoded = btoon.encode(tabularData);
      expect(encoded).to.be.an.instanceof(Buffer);
      expect(encoded.length).to.be.greaterThan(0);
    });
  });

  describe('Decoding', () => {
    it('should decode basic data types correctly', () => {
      const data = {
        string: 'Hello, BTOON!',
        number: 42,
        boolean: true,
        nullValue: null,
        array: [1, 2, 3],
        nested: { a: 1, b: 'test' }
      };
      const encoded = btoon.encode(data);
      const decoded = btoon.decode(encoded);
      expect(decoded).to.deep.equal(data);
    });

    it('should decode tabular data correctly', () => {
      const tabularData = {
        table: [
          { id: 1, name: 'Alice', age: 25 },
          { id: 2, name: 'Bob', age: 30 },
          { id: 3, name: 'Charlie', age: 35 }
        ]
      };
      const encoded = btoon.encode(tabularData);
      const decoded = btoon.decode(encoded);
      expect(decoded).to.deep.equal(tabularData);
    });
  });

  describe('Error Handling', () => {
    it('should throw an error for invalid encoded data', () => {
      // Use data that starts with an invalid marker (0xc1 is reserved and not a valid BTOON marker)
      const invalidBuffer = Buffer.from([0xc1, 0x00, 0x01, 0x02]);
      expect(() => btoon.decode(invalidBuffer)).to.throw();
    });
  });
});
