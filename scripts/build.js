#!/usr/bin/env node

/**
 * Build script - Minifies JavaScript for production
 */

const { minify } = require('terser');
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '../public/js');
const DIST_DIR = path.join(__dirname, '../public/js/dist');

// Files to minify
const files = ['display.js', 'host.js', 'host-login.js', 'play.js', 'logger.js', 'sound.js', 'utils.js'];

// Terser options
const terserOptions = {
  compress: {
    drop_console: process.env.NODE_ENV === 'production',
    drop_debugger: true,
    dead_code: true,
    unused: true,
  },
  mangle: {
    reserved: ['SoundManager', 'Haptics', 'Logger', 'Utils'], // Preserve global names
  },
  format: {
    comments: false,
  },
  sourceMap: process.env.NODE_ENV !== 'production',
};

async function build() {
  console.log('🔨 Building minified JavaScript...\n');

  // Create dist directory
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  let totalOriginal = 0;
  let totalMinified = 0;

  for (const file of files) {
    const inputPath = path.join(JS_DIR, file);
    const outputPath = path.join(DIST_DIR, file.replace('.js', '.min.js'));

    // Skip if file doesn't exist
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${file} (not found)`);
      continue;
    }

    try {
      const code = fs.readFileSync(inputPath, 'utf8');
      const result = await minify(code, terserOptions);

      if (result.code) {
        fs.writeFileSync(outputPath, result.code);

        const originalSize = Buffer.byteLength(code, 'utf8');
        const minifiedSize = Buffer.byteLength(result.code, 'utf8');
        const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);

        totalOriginal += originalSize;
        totalMinified += minifiedSize;

        console.log(`✅ ${file}`);
        console.log(`   ${(originalSize / 1024).toFixed(1)}KB → ${(minifiedSize / 1024).toFixed(1)}KB (${savings}% smaller)`);
      }
    } catch (err) {
      console.error(`❌ Error minifying ${file}:`, err.message);
    }
  }

  console.log('\n📦 Build complete!');
  console.log(`   Total: ${(totalOriginal / 1024).toFixed(1)}KB → ${(totalMinified / 1024).toFixed(1)}KB`);
  console.log(`   Saved: ${((1 - totalMinified / totalOriginal) * 100).toFixed(1)}%`);
}

build().catch(console.error);

