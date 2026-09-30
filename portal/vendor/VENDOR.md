# Vendored code

## age-encryption.js

- Package: `age-encryption` (typage, https://github.com/FiloSottile/typage), version **0.3.1**, exact.
- License: BSD-3-Clause. Bundled dependencies (`@noble/ciphers` 2.4.0, `@noble/hashes` 2.4.0, `@noble/curves` 2.4.0, `@noble/post-quantum` 0.5.4, `@scure/base` 2.4.0) are MIT. License comments are kept inline in the file.
- npm integrity of the package tarball: `sha512-bYgd7lxM7tEANmb9bXf7xTFB3Qpq+JGKinVSdFh5MV+t2fJJZSTdKhWkvXTFJQGysZd+K9Dt3F+n+4DKazXlnQ==`
- sha256 of `age-encryption.js`: `beb7cf2ddf9cc3b487045f87b27fba7eaaa4630362b6764d1a74bea86bd9f32e`
- Exports: `Encrypter`, `Decrypter`, `armor`. The portal uses passphrase (scrypt) mode only, work factor 2^18, binary output.

Rebuild, from an empty directory:

```sh
npm init -y
npm install --save-exact age-encryption@0.3.1 esbuild@0.25.10
printf 'export { Encrypter, Decrypter, armor } from "age-encryption";\n' > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser --target=es2022 \
  --minify --legal-comments=inline --outfile=age-encryption.js
shasum -a 256 age-encryption.js
```

The page loads this file from this site. No CDN at runtime. A new version means a new sha256 here.

Checked: a file encrypted by this bundle decrypts with the Go `age` CLI v1.2.1 (filippo.io/age), binary and armored, and a wrong passphrase is refused.
