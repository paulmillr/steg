import aes, { utils as aesUtils } from 'micro-aes-gcm';
const ENCRYPTED_METADATA_SIZE = 28;
function validateBits(bitsTaken) {
    const b = bitsTaken;
    if (!(Number.isSafeInteger(b) && b >= 1 && b <= 8))
        throw new Error('Bits taken must be >= 1 and <= 8');
}
function clearBits(n, bits) {
    return (n >> bits) << bits;
}
function readBit(byte, pos) {
    return (byte >> (7 - pos)) & 1;
}
function isAlpha(pixel) {
    return pixel % 4 === 3;
}
function getRandomByte() {
    return aesUtils.randomBytes(1)[0];
}
export const createView = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
export class RawFile {
    constructor(data, name) {
        this.data = data;
        this.name = name;
        this.size = data.byteLength;
        if (!this.name)
            this.name = `file-${this.size}.file`;
    }
    static fromPacked(packed) {
        const padded = Uint8Array.from(packed);
        const view = createView(padded);
        let offset = 0;
        const nsize = view.getUint8(offset);
        offset += 1;
        if (nsize < 1)
            throw new Error('file name must contain at least 1 character');
        const name = utils.bytesToUtf8(padded.subarray(offset, offset + nsize));
        offset += nsize;
        const fsize = view.getUint32(offset);
        offset += 4;
        const unpadded = padded.subarray(offset, offset + fsize);
        return new RawFile(unpadded, name);
    }
    static async fromFileInput(element) {
        return new Promise((resolve, reject) => {
            const file = FileReader && element.files && element.files[0];
            if (!file)
                return reject();
            const reader = new FileReader();
            reader.addEventListener('load', () => {
                let res = reader.result;
                if (typeof res === 'string')
                    res = utils.utf8ToBytes(res);
                if (!res)
                    return reject(new Error('No file'));
                resolve(new RawFile(new Uint8Array(res), file.name));
            });
            reader.addEventListener('error', reject);
            reader.readAsArrayBuffer(file);
        });
    }
    createHeader() {
        const nbytes = utils.utf8ToBytes(this.name);
        const nsize = nbytes.byteLength;
        if (nsize < 1 || nsize > 255)
            throw new Error('File name must be 1-255 chars');
        const metadataSize = 1 + nsize + 4;
        const meta = new Uint8Array(metadataSize);
        const view = createView(meta);
        let offset = 0;
        view.setUint8(offset, nsize);
        offset += 1;
        meta.set(nbytes, offset);
        offset += nsize;
        view.setUint32(offset, this.size);
        offset += 4;
        return meta;
    }
    pack() {
        const header = this.createHeader();
        const packed = new Uint8Array(header.byteLength + this.size);
        packed.set(header);
        packed.set(this.data, header.byteLength);
        return packed;
    }
    packWithPadding(requiredLength) {
        const packed = this.pack();
        const difference = requiredLength - packed.length;
        if (difference < 0)
            throw new Error('requiredLength is lesser than result');
        const padded = new Uint8Array(packed.length + difference);
        padded.set(packed, 0);
        return padded;
    }
    download() {
        utils.downloadFile(utils.bytesToURL(this.data), this.name);
    }
}
export class StegImage {
    constructor(image) {
        this.image = image;
        const { canvas, imageData } = this.createCanvas(image);
        this.canvas = canvas;
        this.imageData = imageData;
    }
    static async fromBytesOrURL(urlOrBytes) {
        const image = new Image();
        const src = urlOrBytes instanceof Uint8Array ? utils.bytesToURL(urlOrBytes) : urlOrBytes;
        await utils.setImageSource(image, src, true);
        return new StegImage(image);
    }
    createCanvas(image = this.image) {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context)
            throw new Error('Invalid context');
        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, image.width, image.height);
        return { canvas, imageData };
    }
    reset() {
        const { canvas, imageData } = this.createCanvas();
        this.canvas = canvas;
        this.imageData = imageData;
    }
    calcCapacity(bitsTaken) {
        validateBits(bitsTaken);
        const channels = this.imageData.data;
        const rgba = 4;
        const channelsNoFirst = channels.length - rgba;
        const pixels = channelsNoFirst / rgba;
        const rgb = 3;
        const bits = pixels * rgb * bitsTaken;
        const bytes = Math.floor(bits / 8);
        return { bits, bytes };
    }
    async hide(rawFile, key, bitsTaken = 1) {
        const capacity = this.calcCapacity(bitsTaken).bytes;
        const packed = rawFile.packWithPadding(capacity - ENCRYPTED_METADATA_SIZE);
        const ciphertext = await aes.encrypt(key, packed);
        if (ciphertext.byteLength !== capacity)
            throw new Error('Encrypted blob must be equal to total data length');
        return await this.hideBlob(ciphertext, bitsTaken);
    }
    async reveal(key) {
        const ciphertext = await this.revealBlob();
        const packed = await aes.decrypt(key, ciphertext);
        return RawFile.fromPacked(packed);
    }
    async hideBlob(hData, bitsTaken = 1) {
        if (!(hData instanceof Uint8Array))
            throw new Error('Uint8Array expected');
        const canvas = this.canvas;
        const channels = this.imageData.data;
        const channelsLen = channels.length;
        const hDataLen = hData.byteLength;
        validateBits(bitsTaken);
        const cap = this.calcCapacity(bitsTaken).bytes;
        if (hDataLen > cap)
            throw new Error('StegImage#hideBlob: ' +
                `Can't hide ${hDataLen} bytes in ${cap} bytes at ${bitsTaken} bits taken`);
        let channelId = 0;
        function writeChannel(data, bits = bitsTaken) {
            const curr = channels[channelId];
            channels[channelId++] = clearBits(curr, bits) | data;
            if (isAlpha(channelId))
                channels[channelId++] = 256;
        }
        while (channelId < 3)
            writeChannel(readBit(bitsTaken - 1, 8 - 3 + channelId), 1);
        let buf = 0;
        let bufBits = 0;
        for (let byte = 0; byte < hData.length; byte++) {
            let hiddenDataByte = hData[byte];
            for (let bit = 0; bit < 8; bit++) {
                buf = (buf << 1) | readBit(hiddenDataByte, bit);
                bufBits++;
                if (bufBits === bitsTaken) {
                    writeChannel(buf);
                    buf = 0;
                    bufBits = 0;
                }
            }
        }
        if (bufBits) {
            const randomByte = getRandomByte();
            const leftoverBits = bitsTaken - bufBits;
            for (let i = 0; i < leftoverBits; i++) {
                if (i > 7)
                    throw new Error('StegImage#hideBlob: Need more than 7 random bits');
                const randomBit = readBit(randomByte, i);
                buf = (buf << 1) | randomBit;
                bufBits++;
            }
            if (bufBits !== bitsTaken)
                throw new Error('StegImage#hideBlob: bufBits !== bitsTaken');
            writeChannel(buf);
        }
        while (channelId < channelsLen) {
            const randomByte = getRandomByte();
            const bitsTakenMask = 2 ** bitsTaken - 1;
            writeChannel(randomByte & bitsTakenMask);
        }
        if (channelId !== channelsLen) {
            throw new Error('StegImage#hideBlob: Current pixel length ' +
                `${channelId} is different from total capacity ${channelsLen}`);
        }
        const vctx = canvas.getContext('2d');
        if (!vctx)
            throw new Error('StegImage#hideBlob: No context');
        vctx.putImageData(this.imageData, 0, 0);
        const vchannels = vctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < channelsLen; i++) {
            const v1 = channels[i];
            const v2 = vchannels[i];
            if (v1 !== v2) {
                throw new Error(`StegImage#hideBlob: Mismatch after verification; idx=${i} v1=${v1} v2=${v2} pos=${i % 4}`);
            }
        }
        return await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
                if (b)
                    resolve(URL.createObjectURL(b));
                else
                    reject(new Error('StegImage#hideBlob: No blob'));
                this.reset();
            });
        });
    }
    revealBitsTaken() {
        const channels = this.imageData.data;
        const bit0 = readBit(channels[0], 7) << 2;
        const bit1 = readBit(channels[1], 7) << 1;
        const bit2 = readBit(channels[2], 7);
        const bitsTaken = 1 + (bit0 | bit1 | bit2);
        validateBits(bitsTaken);
        return bitsTaken;
    }
    async revealBlob() {
        const channels = this.imageData.data;
        const bitsTaken = this.revealBitsTaken();
        const { bytes } = this.calcCapacity(bitsTaken);
        const mask = 2 ** bitsTaken - 1;
        let buf = 0;
        let bufBits = 0;
        const out = new Uint8Array(bytes);
        let outPos = 0;
        for (let channelId = 4; channelId < channels.length; channelId++) {
            if (isAlpha(channelId))
                channelId++;
            buf = (buf << bitsTaken) | (channels[channelId] & mask);
            bufBits += bitsTaken;
            if (bufBits >= 8) {
                const leftBits = bufBits - 8;
                out[outPos++] = buf >> leftBits;
                buf = buf & (2 ** leftBits - 1);
                bufBits = leftBits;
            }
        }
        return out;
    }
}
export const utils = {
    utf8ToBytes(str) {
        return new TextEncoder().encode(str);
    },
    bytesToUtf8(bytes) {
        return new TextDecoder().decode(bytes);
    },
    bytesToURL(bytes) {
        return URL.createObjectURL(new Blob([bytes]));
    },
    setImageSource(el, url, revoke = false) {
        return new Promise((resolve) => {
            el.src = url;
            el.addEventListener('load', () => {
                if (revoke)
                    URL.revokeObjectURL(url);
                resolve();
            });
        });
    },
    downloadFile(url, fileName = `hidden-${new Date().toISOString()}.png`) {
        const link = document.createElement('a');
        link.href = url;
        link.textContent = 'Download';
        link.setAttribute('download', fileName);
        link.click();
    },
    formatSize(bytes) {
        const KB = 1024;
        const MB = 1024 * 1024;
        if (bytes < KB)
            return `${bytes}B`;
        if (bytes < MB)
            return `${(bytes / KB).toFixed(2)}KB`;
        return `${(bytes / MB).toFixed(2)}MB`;
    }
};
