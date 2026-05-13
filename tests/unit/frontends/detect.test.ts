import { describe, it, expect } from 'vitest';
import { detectLanguage, isSupported } from '../../../src/frontends/detect.js';

describe('detectLanguage', () => {
  describe('TypeScript files', () => {
    it('should detect .ts files', () => {
      expect(detectLanguage('file.ts')).toBe('typescript');
      expect(detectLanguage('path/to/file.ts')).toBe('typescript');
      expect(detectLanguage('/absolute/path/file.ts')).toBe('typescript');
    });

    it('should detect .tsx files', () => {
      expect(detectLanguage('file.tsx')).toBe('typescript');
      expect(detectLanguage('path/to/component.tsx')).toBe('typescript');
    });

    it('should be case insensitive for extension', () => {
      expect(detectLanguage('file.TS')).toBe('typescript');
      expect(detectLanguage('file.Tsx')).toBe('typescript');
    });
  });

  describe('JavaScript files', () => {
    it('should detect .js files', () => {
      expect(detectLanguage('file.js')).toBe('javascript');
      expect(detectLanguage('path/to/file.js')).toBe('javascript');
    });

    it('should detect .jsx files', () => {
      expect(detectLanguage('file.jsx')).toBe('javascript');
      expect(detectLanguage('path/to/component.jsx')).toBe('javascript');
    });
  });

  describe('Rust files', () => {
    it('should detect .rs files', () => {
      expect(detectLanguage('lib.rs')).toBe('rust');
      expect(detectLanguage('path/to/main.rs')).toBe('rust');
    });
  });

  describe('Python files', () => {
    it('should detect .py files', () => {
      expect(detectLanguage('main.py')).toBe('python');
      expect(detectLanguage('path/to/script.py')).toBe('python');
    });
  });

  describe('C files', () => {
    it('should detect .c files', () => {
      expect(detectLanguage('file.c')).toBe('c');
    });

    // Note: .h files default to C++ for better C++ project support
    // Pure C projects should use .h files in the same directory as .c files
    it('should not detect .h files as C (default is C++)', () => {
      expect(detectLanguage('header.h')).toBe('cpp');
    });
  });

  describe('C++ files', () => {
    it('should detect .cpp files', () => {
      expect(detectLanguage('file.cpp')).toBe('cpp');
    });

    it('should detect .cc files', () => {
      expect(detectLanguage('file.cc')).toBe('cpp');
    });

    it('should detect .cxx files', () => {
      expect(detectLanguage('file.cxx')).toBe('cpp');
    });

    it('should detect .hpp files', () => {
      expect(detectLanguage('header.hpp')).toBe('cpp');
    });

    it('should detect .hh files', () => {
      expect(detectLanguage('header.hh')).toBe('cpp');
    });
  });

  describe('unsupported files', () => {
    it('should return null for unknown extensions', () => {
      expect(detectLanguage('file.txt')).toBe(null);
      expect(detectLanguage('file.md')).toBe(null);
      expect(detectLanguage('file.json')).toBe(null);
      expect(detectLanguage('file.yml')).toBe(null);
      expect(detectLanguage('file.yaml')).toBe(null);
    });

    it('should return null for files without extension', () => {
      expect(detectLanguage('Makefile')).toBe(null);
      expect(detectLanguage('Dockerfile')).toBe(null);
    });

    it('should return null for dotfiles', () => {
      expect(detectLanguage('.gitignore')).toBe(null);
      expect(detectLanguage('.env')).toBe(null);
    });
  });
});

describe('isSupported', () => {
  it('should return true for supported file extensions', () => {
    expect(isSupported('file.ts')).toBe(true);
    expect(isSupported('file.tsx')).toBe(true);
    expect(isSupported('file.js')).toBe(true);
    expect(isSupported('file.jsx')).toBe(true);
    expect(isSupported('file.rs')).toBe(true);
    expect(isSupported('file.py')).toBe(true);
    expect(isSupported('file.cpp')).toBe(true);
    expect(isSupported('file.cc')).toBe(true);
    expect(isSupported('file.cxx')).toBe(true);
    expect(isSupported('file.h')).toBe(true);
    expect(isSupported('file.hpp')).toBe(true);
  });

  it('should return false for unsupported file extensions', () => {
    expect(isSupported('file.txt')).toBe(false);
    expect(isSupported('file.md')).toBe(false);
    expect(isSupported('file.json')).toBe(false);
    expect(isSupported('file.yml')).toBe(false);
    expect(isSupported('file.yaml')).toBe(false);
    expect(isSupported('file.html')).toBe(false);
    expect(isSupported('file.css')).toBe(false);
  });

  it('should return false for files without extension', () => {
    expect(isSupported('Makefile')).toBe(false);
    expect(isSupported('Dockerfile')).toBe(false);
  });
});
