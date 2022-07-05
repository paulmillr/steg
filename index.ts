import aes, { utils as aesUtils } from 'micro-aes-gcm';

const ENCRYPTED_METADATA_SIZE = 28; // AES-GCM 12-byte IV + 16-byte auth tag

function validateBits(bitsTaken: number) {
  const b = bitsTaken;
  if (!(Number.isSafeInteger(b) && b >= 1 && b <= 8))
    throw new Error('Bits taken must be >= 1 and <= 8');
}

// clearBits(0b101010, 4) => 0b100000
function clearBits(n: number, bits: number): number {
  return (n >> bits) << bits;
}

function readBit(byte: number, pos: number): number {
  return (byte >> (7 - pos)) & 1;
}

function isAlpha(pixel: number): boolean {
  return pixel % 4 === 3;
}

function getRandomByte(): number {
  return aesUtils.randomBytes(1)[0];
}

export const createView = (arr: Uint8Array) =>
  new DataView(arr.buffer, arr.byteOffset, arr.byteLength);

type PackedFile = Uint8Array;

/**
 * Represents a file, its name and size.
 *
 * We store the file name, because if you hide many files, it can be hard to find them.
 * Create a flat byte array structure with 5 fields ABCDE, that represents file and its metadata:
 *   * A `bytes 0..1`  name length, 4GB max
 *   * B `bytes 1..[1+name length]` name, 32 bytes max
 *   * C `bytes B..B+4` file size length, 4GB max
 *   * D `bytes C..[C+file length]` file contents
 *   * E `bytes D..end` padding filled with zeros — zeros are okay, since we encrypt them
 * @example
 *   const file = new RawFile(utils.utf8ToBytes('hello world'), 'file.txt');
 *   file.pack();
 */
export class RawFile {
  readonly size: number;

  /**
   * Unpacks packed file. Packed file is size||name||contents.
   */
  static fromPacked(packed: PackedFile): RawFile {
    const padded = Uint8Array.from(packed);
    const view = createView(padded);

    let offset = 0;
    const nsize = view.getUint8(offset);
    offset += 1;
    if (nsize < 1) throw new Error('file name must contain at least 1 character');

    const name = utils.bytesToUtf8(padded.subarray(offset, offset + nsize));
    offset += nsize;

    const fsize = view.getUint32(offset);
    offset += 4;

    const unpadded = padded.subarray(offset, offset + fsize);
    return new RawFile(unpadded, name);
  }

  /**
   * Reads HTML input[type=file] into byte array and creates new RawFile from it
   * @param element input[type=file]
   */
  static async fromFileInput(element: HTMLInputElement): Promise<RawFile> {
    return new Promise((resolve, reject) => {
      const file = FileReader && element.files && element.files[0];
      if (!file) return reject();
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        let res = reader.result;
        if (typeof res === 'string') res = utils.utf8ToBytes(res);
        if (!res) return reject(new Error('No file'));
        resolve(new RawFile(new Uint8Array(res), file.name));
      });
      reader.addEventListener('error', reject);
      reader.readAsArrayBuffer(file);
    });
  }

  constructor(readonly data: Uint8Array, readonly name: string) {
    this.size = data.byteLength;
    if (!this.name) this.name = `file-${this.size}.file`;
  }

  protected createHeader() {
    const nbytes = utils.utf8ToBytes(this.name);
    const nsize = nbytes.byteLength;
    if (nsize < 1 || nsize > 255) throw new Error('File name must be 1-255 chars');

    const metadataSize = 1 + nsize + 4;
    const meta = new Uint8Array(metadataSize);
    const view = createView(meta);

    // name length
    let offset = 0;
    view.setUint8(offset, nsize);
    offset += 1;
    // name
    meta.set(nbytes, offset);
    offset += nsize;
    // size
    view.setUint32(offset, this.size);
    offset += 4;
    return meta;
  }

  /**
   * Creates (size||name||contents) byte array from RawFile.
   */
  pack(): PackedFile {
    const header = this.createHeader();
    const packed = new Uint8Array(header.byteLength + this.size);
    // packed = header || data
    packed.set(header);
    packed.set(this.data, header.byteLength);
    return packed;
  }

  /**
   * Creates (size||name||contents||padding) byte array from RawFile.
   * Warning: pads with zeros, which are detectable if used as-is.
   * However, the result would be encrypted, so we don't care about that.
   * There is no need to use CSPRNG instead of zeros: even if we've did,
   * the size||name stuff would still be detectable.
   * When used with encryption, make sure to reduce requiredLength by
   * encryption metadata size.
   * @param requiredLength byte array of this length would be created
   */
  packWithPadding(requiredLength: number): PackedFile {
    const packed = this.pack();
    const difference = requiredLength - packed.length;
    if (difference < 0) throw new Error('requiredLength is lesser than result');
    const padded = new Uint8Array(packed.length + difference);
    padded.set(packed, 0);
    return padded;
  }

  download() {
    utils.downloadFile(utils.bytesToURL(this.data), this.name);
  }
}

/**
 * StegImage represents a PNG image that may contain hidden data.
 * First 4 bits contain `bitsTaken` param which tells `StegImage.reveal()`
 * How much bits we should take from every pixel.
 * Encryption disguises hidden data and makes it unrecognizable from garbage.
 * TODO: investigate if `bitsTaken` can be used to detect steg; research alternatives.
 * @example
 *   const png = new StegImage(document.querySelector('.user-image'));
 *   const file = new RawFile(utf8ToBytes('hello'), 'readme.txt');
 *   const encryptionKey = randomBytes(32);
 *   const stegPng = await png.hide(file, encryptionKey);
 */
export class StegImage {
  protected canvas: HTMLCanvasElement;
  protected imageData: ImageData;
  static async fromBytesOrURL(urlOrBytes: string | Uint8Array): Promise<StegImage> {
    const image = new Image();
    const src = urlOrBytes instanceof Uint8Array ? utils.bytesToURL(urlOrBytes) : urlOrBytes;
    await utils.setImageSource(image, src, true);
    return new StegImage(image);
  }
  constructor(protected readonly image: HTMLImageElement) {
    const { canvas, imageData } = this.createCanvas(image);
    this.canvas = canvas;
    this.imageData = imageData;
  }

  protected createCanvas(image = this.image) {
    // const { image } = this;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Invalid context');
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, image.width, image.height);
    // if (urlOrBytes instanceof Uint8Array) URL.revokeObjectURL(image.src);
    return { canvas, imageData };
  }
  // We repeat constructor logic, but we cannot reuse reset() in constructor because
  // of TypeScript errors
  protected reset() {
    const { canvas, imageData } = this.createCanvas();
    this.canvas = canvas;
    this.imageData = imageData;
  }

  calcCapacity(bitsTaken: number) {
    validateBits(bitsTaken);
    // Total RGBA channels
    const channels = this.imageData!.data;
    const rgba = 4;
    // First pixel is used for storing bitsTaken
    const channelsNoFirst = channels.length - rgba;
    // Calculate total pixels by dividing channels by RGBA
    const pixels = channelsNoFirst / rgba;
    // We don't use alpha channel
    const rgb = 3;
    // Multiply pixels by RGB since we don't use alpha channel
    const bits = pixels * rgb * bitsTaken;
    // 15 bits = 1 byte, not 2 bytes
    const bytes = Math.floor(bits / 8);
    return { bits, bytes };
  }

  // End result is:
  // 12-byte IV ||
  // encrypted file data (4-byte size || 32-byte name || plaintext data || zeros-padding) ||
  // 16-byte auth tag
  async hide(rawFile: RawFile, key: Uint8Array, bitsTaken = 1): Promise<string> {
    const capacity = this.calcCapacity(bitsTaken).bytes;
    const packed = rawFile.packWithPadding(capacity - ENCRYPTED_METADATA_SIZE);
    const ciphertext = await aes.encrypt(key, packed);
    if (ciphertext.byteLength !== capacity)
      throw new Error('Encrypted blob must be equal to total data length');
    return await this.hideBlob(ciphertext, bitsTaken);
  }

  async reveal(key: Uint8Array): Promise<RawFile> {
    const ciphertext = await this.revealBlob();
    const packed = await aes.decrypt(key, ciphertext);
    return RawFile.fromPacked(packed); // compatible with RawFile and PaddedFile
  }

  /**
   * Hides arbitrary data in png.
   * Don't use it directly, prefer `hide()` with padding & encryption.
   * 1 pixel is represented by 4 bytes RGBA. We can use:
   *
   * 1. RGB channels to encode data (24 bits)
   * 2. A alpha / transparency channel (8 bit)
   *
   * PNG encoder in browsers losses data because of alpha channel multiplication optimization.
   * Because of that, and since 24 > 8, we pick 1). Summing up, inside 1 pixel we can hide
   * from 3 bits at bitsTaken=1 up to 24 bits at bitsTaken=8.
   * @param hData - data that would be hidden inside of the png
   * @param bitsTaken - how many bits we can place in single channel
   * @returns url
   */
  async hideBlob(hData: Uint8Array, bitsTaken = 1): Promise<string> {
    if (!(hData instanceof Uint8Array)) throw new Error('Uint8Array expected');
    // TODO:
    const canvas = this.canvas;
    const channels = this.imageData!.data;
    const channelsLen = channels.length;
    const hDataLen = hData.byteLength;
    validateBits(bitsTaken);
    const cap = this.calcCapacity(bitsTaken).bytes;
    if (hDataLen > cap)
      throw new Error(
        'StegImage#hideBlob: ' +
          `Can't hide ${hDataLen} bytes in ${cap} bytes at ${bitsTaken} bits taken`
      );
    let channelId = 0; // first channel of second pixel
    function writeChannel(data: number, bits = bitsTaken) {
      const curr = channels[channelId];
      channels[channelId++] = clearBits(curr, bits) | data;
      // alpha channel is always black, skip
      // TODO: 256 is 0, maybe we need 255?
      if (isAlpha(channelId)) channels[channelId++] = 256;
    }

    // First pixel aka first 4 bytes represent amount of bits per value.
    // NOTE: this is the only value stored in plaintext, we can't encrypt it,
    // because we won't know how many bits per channel to read.
    // Instead of storing bitsTaken, another approach would be to walk through all
    // possible bitsTaken choices, but it will make the process 8x slower:
    //     for (let i = 1; i < 9; i++) try { return reveal({ bitsTaken: i }); } catch(e) {}
    //     throw new Error('Cannot find data');

    // read bits starting from 5 (bitsTaken can be 3 bit (7) at most)
    // bitsTaken-1 is because we store 1..8 in 0..7
    while (channelId < 3) writeChannel(readBit(bitsTaken - 1, 8 - 3 + channelId), 1);
    // Buffer to place bits
    let buf = 0;
    // How many bits we've placed into buffer
    let bufBits = 0;
    // Start hiding the data
    for (let byte = 0; byte < hData.length; byte++) {
      let hiddenDataByte = hData[byte];
      // Iterate through byte bits
      for (let bit = 0; bit < 8; bit++) {
        // buf.push(bit)
        // 0b111 << 1     = 0b1110
        // 0b111 << 1 | 1 = 0b1111
        buf = (buf << 1) | readBit(hiddenDataByte, bit);
        // We've added one bit, increment the counter
        bufBits++;
        // We have enough data to write in single channel of current pixel
        if (bufBits === bitsTaken) {
          writeChannel(buf);
          buf = 0;
          bufBits = 0;
        }
      }
    }
    // Leftovers, at this point we have some bits in buffer, but they are less
    // bitsTaken, so we cannot write full channel
    if (bufBits) {
      const randomByte = getRandomByte();
      // How many random bits we need to write in buffer
      const leftoverBits = bitsTaken - bufBits;
      for (let i = 0; i < leftoverBits; i++) {
        // Should not happen
        if (i > 7) throw new Error('StegImage#hideBlob: Need more than 7 random bits');
        const randomBit = readBit(randomByte, i);
        // Write random bit to buffer
        buf = (buf << 1) | randomBit;
        // We've added one bit, increment the counter
        bufBits++;
      }
      // Should not happen
      if (bufBits !== bitsTaken) throw new Error('StegImage#hideBlob: bufBits !== bitsTaken');
      writeChannel(buf);
    }
    // Even after flushing buffer, there still can be channels without randomData
    while (channelId < channelsLen) {
      const randomByte = getRandomByte();
      const bitsTakenMask = 2 ** bitsTaken - 1;
      writeChannel(randomByte & bitsTakenMask);
    }
    if (channelId !== channelsLen) {
      throw new Error(
        'StegImage#hideBlob: Current pixel length ' +
          `${channelId} is different from total capacity ${channelsLen}`
      );
    }

    const vctx = canvas.getContext('2d');
    if (!vctx) throw new Error('StegImage#hideBlob: No context');
    // Write data to image
    vctx.putImageData(this.imageData, 0, 0);

    // Verify that image contains same data after re-decoding.
    const vchannels = vctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < channelsLen; i++) {
      const v1 = channels[i];
      const v2 = vchannels[i];
      if (v1 !== v2) {
        throw new Error(
          `StegImage#hideBlob: Mismatch after verification; idx=${i} v1=${v1} v2=${v2} pos=${i % 4}`
        );
      }
    }

    return await new Promise((resolve, reject) => {
      // toDataURL() is 300ms slower, probably because of base64 encoding
      canvas.toBlob((b) => {
        if (b) resolve(URL.createObjectURL(b));
        else reject(new Error('StegImage#hideBlob: No blob'));
        this.reset();
      });
    });
  }

  // Can throw
  revealBitsTaken(): number {
    const channels = this.imageData.data;
    const bit0 = readBit(channels[0], 7) << 2;
    const bit1 = readBit(channels[1], 7) << 1;
    const bit2 = readBit(channels[2], 7);
    // 0 represents 1 bitsTaken, 7 represents 8.
    const bitsTaken = 1 + (bit0 | bit1 | bit2);
    validateBits(bitsTaken);
    return bitsTaken;
  }

  async revealBlob(): Promise<Uint8Array> {
    const channels = this.imageData.data;
    const bitsTaken = this.revealBitsTaken();
    // We can read up to this amount of bytes from image
    const { bytes } = this.calcCapacity(bitsTaken);
    const mask = 2 ** bitsTaken - 1;
    let buf = 0;
    let bufBits = 0;
    const out = new Uint8Array(bytes);
    let outPos = 0;
    for (let channelId = 4; channelId < channels.length; channelId++) {
      // skip alpha channel
      if (isAlpha(channelId)) channelId++;
      // read bitsTaken bits from current channel into buffer
      buf = (buf << bitsTaken) | (channels[channelId] & mask);
      bufBits += bitsTaken;
      // If buffer has at least 8 bits, we can create byte from them
      if (bufBits >= 8) {
        // push 8 bits from buffer to bytes
        const leftBits = bufBits - 8;
        out[outPos++] = buf >> leftBits;
        // remove 8 bits from buffer
        buf = buf & (2 ** leftBits - 1);
        bufBits = leftBits;
      }
    }
    return out;
  }
}

export const utils = {
  utf8ToBytes(str: string) {
    return new TextEncoder().encode(str);
  },
  bytesToUtf8(bytes: Uint8Array) {
    return new TextDecoder().decode(bytes);
  },
  bytesToURL(bytes: Uint8Array) {
    return URL.createObjectURL(new Blob([bytes]));
  },
  setImageSource(el: HTMLImageElement, url: string, revoke = false): Promise<void> {
    return new Promise((resolve) => {
      el.src = url;
      el.addEventListener('load', () => {
        // Revoking object URL would still show the image on page, but
        // the ability to download it would be broken.
        if (revoke) URL.revokeObjectURL(url);
        resolve();
      });
    });
  },
  downloadFile(url: string, fileName = `hidden-${new Date().toISOString()}.png`) {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'Download';
    link.setAttribute('download', fileName);
    link.click();
  },
  formatSize(bytes: number): string {
    const KB = 1024;
    const MB = 1024 * 1024;
    if (bytes < KB) return `${bytes}B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(2)}KB`;
    return `${(bytes / MB).toFixed(2)}MB`;
  }
};
