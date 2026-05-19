import esbuild from 'esbuild'

const production = process.argv.includes('production')

await esbuild.build({
  banner: {
    js: '/* mx-space-publisher */',
  },
  bundle: true,
  entryPoints: ['src/main.ts'],
  external: ['obsidian'],
  format: 'cjs',
  logLevel: 'info',
  minify: production,
  outfile: 'main.js',
  platform: 'browser',
  sourcemap: production ? false : 'inline',
  target: 'es2022',
  treeShaking: true,
})

