import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'index.js',
  output: {
    file: 'steg5k.js',
    format: 'umd',
    name: 'steg5k',
    exports: 'named',
    preferConst: true,
  },
  plugins: [resolve(), commonjs()],
};
