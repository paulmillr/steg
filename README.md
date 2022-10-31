# Steg

> Simple and secure steganography

Encrypt and hide arbitrary data inside png images. Experimental, use at your own risk.

1. Encodes data using least significant bits of PNG pixels.
2. Only PNGs are supported, JPGs cannot be used - every time you save them, they can get
  re-encoded and some data would be lost, which is a no-go for steganography
3. Encrypts hidden data and its metadata with AES-GCM-256. **Warning:** LSB `bitsTaken` are not encrypted for now.

Consider an example, a `file.txt` with 11-byte `hello world` content. Here's a brief flow of what the library would do:

1. Calculate the capacity of png image at given `bitsTaken` and save it into `capacity`
2. Create a flat byte array structure with 5 fields ABCDE, that represents file and its metadata:
    * A `bytes 0..1`  name length, 4GB max
    * B `bytes 1..[1+name length]` name, 32 bytes max
    * C `bytes B..B+4` file size length, 4GB max
    * D `bytes C..[C+file length]` file contents
    * E `bytes D..end` padding filled with zeros — zeros are okay, since we encrypt them
3. Encrypt ABCDE under given AES key with AES-GCM-256:
    * IV `bytes 0..12` taken from CSPRNG
    * ciphertext `bytes 12..(end-16)` encrypted ABCD
    * auth tag `bytes end-16..end` GCM authentication tag

So, in the end, 11-byte `hello world` text content would need at least 11 + 41 (1+8+4+12+16) bytes of capacity inside
the png under the given `bitsTaken`. In any case, it would consume the whole capacity e.g. 500KB and fill it with encrypted
AES output in order to thwart detection.

## Usage

> npm install steg

Can be only used inside browsers. node.js usage with `node-canvas` that polyfills Canvas API is possible,
but had not been tested.

Check out demo inside `demo` directory, or at https://paulmillr.com/demos/steg/. There is also a 3rd party demo related to Decentralized Identifiers available at https://github.com/OR13/didme.me.

### Hide a text file

Select a png image from the web page and uses it to hide `file.txt` containing `hello world`

```ts
import { RawFile, StegImage, utils } from 'steg';

const file = new RawFile(utils.utf8ToBytes('hello world'), 'file.txt');
const encryptionKey = crypto.getRandomValues(new Uint8Array(32));

const el = document.querySelector('.user-avatar');
const png = new StegImage(el);
const hiddenPngUrl = await png.hide(file, encryptionKey);
```

### Use password to protect files

Using `@noble/hashes` library and Scrypt to derive AES key from an arbitrary password

```ts
import { scrypt } from '@noble/hashes/scrypt';
const passwordBasedKey = scrypt('some-secure-password', 'secure-salt', { N: 2**19, r: 8, p: 1 });
const hiddenPngUrl = await png.hide(file, passwordBasedKey);
```

### Adjust bits used

- `bitsTaken` (default: `1`) can be an integer from `1` to `8`. Lower values makes it harder to detect steganography.

```ts
const hiddenBiggerPngUrl = await png.hide(file, encryptionKey, 5); // Uses 5 bitsTaken
```

### HTML file upload form

The form has two upload inputs: one for image inside which the data will be hidden, one for the data itself.

It also has the password and the bit range selector.

```html
<p><input type="file" id="image" accept="image/*" /><label for="image">Image</label></p>
<p><input type="file" id="data" disabled /><label for="data">File to hide inside image</label></p>
<p><input type="password" id="password" disabled /><label for="password">Password</label></p>
<p><input type="range" id="bits" min="1" max="8" value="1" /><label for="bits">Bits taken</label></p>
<div class="steg-output-container"><img id="output" /></div>
```

Form script:

```ts
const { RawFile, StegImage, utils } = steg;
const cache = {};
const el = (s) => document.querySelector(s);
async function hideDataIntoImage() {
  if (!cache.password) return;
  const bitsTaken = Number.parseInt(el('#bits').value);
  const url = await cache.stegImg.hide(cache.hiddenFile, cache.password, bitsTaken);
  await utils.setImageSource(el('#output'), url);
}
el('#password').addEventListener('change', (ev) => {
  cache.password = ev.target.value;
});
el('#image').addEventListener('change', async (ev) => {
  const img = await RawFile.fromFileInput(ev.target);
  cache.stegImg = await StegImage.fromBytesOrURL(img.data);
  el('#data').disabled = false;
});
el('#data').addEventListener('change', async (ev) => {
  cache.hiddenFile = await RawFile.fromFileInput(ev.target);
  hideDataIntoImage();
});
el('#steg-bits').addEventListener('change', (ev) => {
  el('#steg-bits-value').textContent = ev.target.value;
  hideDataIntoImage();
});
```

## License

MIT (c) Paul Miller [(https://paulmillr.com)](https://paulmillr.com), see LICENSE file.
