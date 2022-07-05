export declare const createView: (arr: Uint8Array) => DataView;
declare type PackedFile = Uint8Array;
export declare class RawFile {
    readonly data: Uint8Array;
    readonly name: string;
    readonly size: number;
    static fromPacked(packed: PackedFile): RawFile;
    static fromFileInput(element: HTMLInputElement): Promise<RawFile>;
    constructor(data: Uint8Array, name: string);
    protected createHeader(): Uint8Array;
    pack(): PackedFile;
    packWithPadding(requiredLength: number): PackedFile;
    download(): void;
}
export declare class StegImage {
    protected readonly image: HTMLImageElement;
    protected canvas: HTMLCanvasElement;
    protected imageData: ImageData;
    static fromBytesOrURL(urlOrBytes: string | Uint8Array): Promise<StegImage>;
    constructor(image: HTMLImageElement);
    protected createCanvas(image?: HTMLImageElement): {
        canvas: HTMLCanvasElement;
        imageData: ImageData;
    };
    protected reset(): void;
    calcCapacity(bitsTaken: number): {
        bits: number;
        bytes: number;
    };
    hide(rawFile: RawFile, key: Uint8Array, bitsTaken?: number): Promise<string>;
    reveal(key: Uint8Array): Promise<RawFile>;
    hideBlob(hData: Uint8Array, bitsTaken?: number): Promise<string>;
    revealBitsTaken(): number;
    revealBlob(): Promise<Uint8Array>;
}
export declare const utils: {
    utf8ToBytes(str: string): Uint8Array;
    bytesToUtf8(bytes: Uint8Array): string;
    bytesToURL(bytes: Uint8Array): string;
    setImageSource(el: HTMLImageElement, url: string, revoke?: boolean): Promise<void>;
    downloadFile(url: string, fileName?: string): void;
    formatSize(bytes: number): string;
};
export {};
//# sourceMappingURL=index.d.ts.map